/**
 * Phase 6 — `server-session-turnhashes-persistence.md` Step 1 (Refs #399).
 *
 * Persistence round-trip unit test: append N real turn hashes through a
 * SessionStore, then construct a SECOND store over the SAME ocas/db handle to
 * simulate a process restart, and assert the rehydrated `turnHashes` survive
 * in order and still resolve in ocas.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash } from "@ocas/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	openSumeruOcas,
	recordPayload,
	type SumeruOcas,
} from "../src/ocas/index.js";
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
		searchIndex: raw.searchIndex,
	};
	return { ocas, raw };
}

/** Record a genuine `@sumeru/turn` node so the hash exists in ocas. */
function recordTurn(ocas: OcasConfig, index: number, content: string): Hash {
	return recordPayload(ocas.store, ocas.turnSchemaHash, {
		index,
		role: index % 2 === 0 ? "user" : "assistant",
		content,
		timestamp: new Date().toISOString(),
		toolCalls: null,
	});
}

describe("session turnHashes persistence — round trip across restart", () => {
	let ocas: OcasConfig;

	beforeEach(() => {
		ocas = makeOcas().ocas;
	});

	it("rehydrates turnHashes in order after a simulated restart", () => {
		const store = createSessionStore(ocas);
		const session = store.create("hermes", "hermes", {}, null, null);

		const hashes: Hash[] = [];
		for (let i = 0; i < 5; i += 1) {
			const h = recordTurn(ocas, i, `turn ${i}`);
			hashes.push(h);
			store.appendTurnHash("hermes", session.id, h);
		}
		expect(store.get("hermes", session.id)?.turnHashes).toEqual(hashes);

		// Simulate a restart: a SECOND store over the SAME ocas/db handle.
		const store2 = createSessionStore(ocas);
		const restored = store2.get("hermes", session.id);
		expect(restored).not.toBeNull();
		expect(restored?.turnHashes.length).toBe(5);
		expect(restored?.turnHashes).toEqual(hashes);

		// Every restored hash resolves in ocas and decodes to the right turn.
		restored?.turnHashes.forEach((h, i) => {
			const node = ocas.store.cas.get(h);
			expect(node).not.toBeNull();
			const payload = node?.payload as { index: number; content: string };
			expect(payload.index).toBe(i);
			expect(payload.content).toBe(`turn ${i}`);
		});
	});

	it("restores session metadata (status, config, gateway scoping)", () => {
		const store = createSessionStore(ocas);
		const cfg = { model: "sonnet-4.5", nested: { a: [1, 2] } };
		const session = store.create("hermes", "hermes", cfg, null, null);

		const store2 = createSessionStore(ocas);
		const restored = store2.get("hermes", session.id);
		expect(restored?.id).toBe(session.id);
		expect(restored?.gateway).toBe("hermes");
		expect(restored?.status).toBe("idle");
		expect(restored?.config).toEqual(cfg);
		expect(restored?.metaHash).toBe(session.metaHash);
		// Gateway scoping preserved on restore.
		expect(store2.get("claude-code", session.id)).toBeNull();
	});

	it("a closed session restores as closed", () => {
		const store = createSessionStore(ocas);
		const session = store.create("hermes", "hermes", {}, null, null);
		store.close("hermes", session.id);

		const store2 = createSessionStore(ocas);
		expect(store2.get("hermes", session.id)?.status).toBe("closed");
	});

	it("an empty session restores with turnHashes: []", () => {
		const store = createSessionStore(ocas);
		const session = store.create("hermes", "hermes", {}, null, null);

		const store2 = createSessionStore(ocas);
		const restored = store2.get("hermes", session.id);
		expect(restored).not.toBeNull();
		expect(restored?.turnHashes).toEqual([]);
	});

	it("append is idempotent across a restart — no duplicate rows, length stable", () => {
		const store = createSessionStore(ocas);
		const session = store.create("hermes", "hermes", {}, null, null);
		const h0 = recordTurn(ocas, 0, "only turn");
		store.appendTurnHash("hermes", session.id, h0);

		// Re-append the SAME position/hash (the in-memory length is already 1,
		// but force the same disk slot to prove ON CONFLICT DO NOTHING).
		ocas.searchIndex.appendSessionTurn(session.id, 0, h0);

		const store2 = createSessionStore(ocas);
		expect(store2.get("hermes", session.id)?.turnHashes).toEqual([h0]);
	});

	it("rehydrated length feeds the next append index (no gap or collision)", () => {
		const store = createSessionStore(ocas);
		const session = store.create("hermes", "hermes", {}, null, null);
		for (let i = 0; i < 3; i += 1) {
			store.appendTurnHash("hermes", session.id, recordTurn(ocas, i, `t${i}`));
		}

		const store2 = createSessionStore(ocas);
		const restored = store2.get("hermes", session.id);
		expect(restored?.turnHashes.length).toBe(3);
		// Snapshot BEFORE the append — `restored` aliases the live session object.
		const restoredHashes = [...(restored?.turnHashes ?? [])];

		// The next appended turn continues at index 3.
		const h3 = recordTurn(ocas, 3, "t3");
		store2.appendTurnHash("hermes", session.id, h3);
		expect(store2.get("hermes", session.id)?.turnHashes.length).toBe(4);

		const store3 = createSessionStore(ocas);
		expect(store3.get("hermes", session.id)?.turnHashes).toEqual([
			...restoredHashes,
			h3,
		]);
	});

	it("lists multiple sessions chronologically after restart", () => {
		const store = createSessionStore(ocas);
		const a = store.create("hermes", "hermes", {}, null, null);
		const b = store.create("hermes", "hermes", {}, null, null);
		const c = store.create("hermes", "hermes", {}, null, null);

		const store2 = createSessionStore(ocas);
		expect(store2.list("hermes").map((s) => s.id)).toEqual([a.id, b.id, c.id]);
	});
});
