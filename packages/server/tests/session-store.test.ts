import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openSumeruOcas, type SumeruOcas } from "../src/ocas/index.js";
import { createSessionStore } from "../src/session/index.js";
import type { OcasConfig } from "../src/types.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

function makeOcas(): { ocas: OcasConfig; raw: SumeruOcas } {
	const raw = openSumeruOcas(tmpOcasDir());
	const ocas: OcasConfig = {
		store: raw.store,
		turnSchemaHash: raw.turnSchemaHash,
		sessionMetaSchemaHash: raw.sessionMetaSchemaHash,
		metaSchemaHash: raw.metaSchemaHash,
		schemaAliases: raw.schemaAliases,
	};
	return { ocas, raw };
}

describe("createSessionStore — basic CRUD", () => {
	let ocas: OcasConfig;

	beforeEach(() => {
		ocas = makeOcas().ocas;
	});

	it("creates a session with idle status and per-gateway scoping", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		expect(a.gateway).toBe("hermes");
		expect(a.status).toBe("idle");
		expect(a.id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		expect(a.config).toEqual({});

		// Per-gateway scoping
		expect(store.get("hermes", a.id)).toEqual(a);
		expect(store.get("claude-code", a.id)).toBeNull();
	});

	it("preserves config opaquely (round-trips unknown fields)", () => {
		const store = createSessionStore(ocas);
		const cfg = {
			model: "sonnet-4.5",
			systemPrompt: "be brief",
			weirdAdapterField: 42,
			nested: { foo: [1, 2, 3] },
		};
		const s = store.create("hermes", "hermes", cfg, null);
		expect(s.config).toEqual(cfg);
		// Same reference → mutation safety is the caller's responsibility, but
		// the stored object is the same one passed in (no normalization).
		expect(s.config).toBe(cfg);
	});

	it("lists sessions in insertion order, scoped per gateway", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		const b = store.create("hermes", "hermes", { model: "x" }, null);
		const d = store.create("claude-code", "claude-code", {}, null);

		const hermes = store.list("hermes");
		expect(hermes.map((s) => s.id)).toEqual([a.id, b.id]);
		const cc = store.list("claude-code");
		expect(cc.map((s) => s.id)).toEqual([d.id]);
	});

	it("returns an empty list for a gateway with no sessions", () => {
		const store = createSessionStore(ocas);
		expect(store.list("hermes")).toEqual([]);
	});

	it("close() flips the status to closed and is idempotent", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		expect(store.close("hermes", a.id)).toBe("closed");
		const after = store.get("hermes", a.id);
		expect(after?.status).toBe("closed");
		// Idempotent re-close
		expect(store.close("hermes", a.id)).toBe("already_closed");
	});

	it("close() returns not_found for unknown ids", () => {
		const store = createSessionStore(ocas);
		expect(store.close("hermes", "ses_DOES_NOT_EXIST")).toBe("not_found");
	});

	it("closed sessions stay queryable in list and get", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", { model: "x" }, null);
		store.close("hermes", a.id);
		const list = store.list("hermes");
		expect(list).toHaveLength(1);
		expect(list[0]?.status).toBe("closed");
		expect(list[0]?.config).toEqual({ model: "x" });
		expect(store.get("hermes", a.id)?.status).toBe("closed");
	});

	it("activeCount excludes closed sessions", () => {
		const store = createSessionStore(ocas);
		expect(store.activeCount("hermes")).toBe(0);
		const a = store.create("hermes", "hermes", {}, null);
		const b = store.create("hermes", "hermes", {}, null);
		expect(store.activeCount("hermes")).toBe(2);
		store.close("hermes", a.id);
		expect(store.activeCount("hermes")).toBe(1);
		store.close("hermes", b.id);
		expect(store.activeCount("hermes")).toBe(0);
	});

	it("create() writes a session-meta node to ocas with a non-empty hash", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", { model: "sonnet-4.5" }, null);
		expect(typeof a.metaHash).toBe("string");
		expect(a.metaHash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
		// The node must be retrievable from ocas
		const node = ocas.store.cas.get(a.metaHash);
		expect(node).not.toBeNull();
	});

	it("appendTurnHash grows the session's internal turnHashes array", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		expect(a.turnHashes).toEqual([]);
		store.appendTurnHash("hermes", a.id, "ABC0123456789");
		store.appendTurnHash("hermes", a.id, "DEF0123456789");
		const after = store.get("hermes", a.id);
		expect(after?.turnHashes).toEqual(["ABC0123456789", "DEF0123456789"]);
	});
});

describe("createSessionStore — state-machine helpers", () => {
	let ocas: OcasConfig;

	beforeEach(() => {
		ocas = makeOcas().ocas;
	});

	it("tryActivate(idle) → ok, marks active", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		const r = store.tryActivate("hermes", a.id);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.session.status).toBe("active");
	});

	it("tryActivate(active) → busy (the future 409 path)", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		store.tryActivate("hermes", a.id);
		const r = store.tryActivate("hermes", a.id);
		expect(r).toEqual({ ok: false, reason: "busy" });
	});

	it("tryActivate(closed) → closed", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		store.close("hermes", a.id);
		const r = store.tryActivate("hermes", a.id);
		expect(r).toEqual({ ok: false, reason: "closed" });
	});

	it("tryActivate(unknown id) → not_found", () => {
		const store = createSessionStore(ocas);
		const r = store.tryActivate("hermes", "ses_NONESUCH");
		expect(r).toEqual({ ok: false, reason: "not_found" });
	});

	it("markIdle(active) → ok, flips to idle", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		store.tryActivate("hermes", a.id);
		const r = store.markIdle("hermes", a.id);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.session.status).toBe("idle");
	});

	it("markIdle(idle) → not_active", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		const r = store.markIdle("hermes", a.id);
		expect(r).toEqual({ ok: false, reason: "not_active" });
	});

	it("markIdle(closed) → not_active", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		store.close("hermes", a.id);
		const r = store.markIdle("hermes", a.id);
		expect(r).toEqual({ ok: false, reason: "not_active" });
	});

	it("close(active) is allowed (active → closed)", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		store.tryActivate("hermes", a.id);
		expect(store.close("hermes", a.id)).toBe("closed");
		expect(store.get("hermes", a.id)?.status).toBe("closed");
	});

	it("once closed, no transition reopens the session", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null);
		store.close("hermes", a.id);
		expect(store.tryActivate("hermes", a.id)).toEqual({
			ok: false,
			reason: "closed",
		});
		expect(store.markIdle("hermes", a.id)).toEqual({
			ok: false,
			reason: "not_active",
		});
		// And re-close stays no-op
		expect(store.close("hermes", a.id)).toBe("already_closed");
	});
});
