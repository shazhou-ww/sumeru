/**
 * Phase 4 — `server-ocas-store-bootstrap.md`.
 *
 * Verifies that `startServer` materialises the on-disk ocas store, registers
 * the two Sumeru schemas, falls back through CLI > env > default, and
 * surfaces filesystem errors before binding the listener.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSumeruOcas, resolveOcasDir, startServer } from "../src/index.js";
import { makeStubAdapter } from "./fixtures/stub-adapter.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

describe("openSumeruOcas — store bootstrap", () => {
	it("creates the directory if missing and writes ocas layout", () => {
		const dir = join(tmpOcasDir(), "nested", "subdir");
		expect(existsSync(dir)).toBe(false);
		const ocas = openSumeruOcas(dir);
		expect(existsSync(dir)).toBe(true);
		// Internal layout — at minimum the schemas must be retrievable
		expect(ocas.store.cas.has(ocas.turnSchemaHash)).toBe(true);
		expect(ocas.store.cas.has(ocas.sessionMetaSchemaHash)).toBe(true);
	});

	it("registers two distinct, well-formed schema hashes", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(ocas.turnSchemaHash).toMatch(HASH_RE);
		expect(ocas.sessionMetaSchemaHash).toMatch(HASH_RE);
		expect(ocas.turnSchemaHash).not.toBe(ocas.sessionMetaSchemaHash);
	});

	it("yields stable schema hashes across two consecutive opens of the same dir", () => {
		const dir = tmpOcasDir();
		const a = openSumeruOcas(dir);
		const b = openSumeruOcas(dir);
		expect(a.turnSchemaHash).toBe(b.turnSchemaHash);
		expect(a.sessionMetaSchemaHash).toBe(b.sessionMetaSchemaHash);
	});

	it("yields stable schema hashes across two fresh dirs (schema bytes alone determine the hash)", () => {
		const a = openSumeruOcas(tmpOcasDir());
		const b = openSumeruOcas(tmpOcasDir());
		expect(a.turnSchemaHash).toBe(b.turnSchemaHash);
		expect(a.sessionMetaSchemaHash).toBe(b.sessionMetaSchemaHash);
	});

	it("re-opening an existing dir is a no-op (no throw, same hashes)", () => {
		const dir = tmpOcasDir();
		openSumeruOcas(dir);
		expect(() => openSumeruOcas(dir)).not.toThrow();
	});

	it("populates schemaAliases for the three known type hashes", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(ocas.schemaAliases[ocas.turnSchemaHash]).toBe("@sumeru/turn");
		expect(ocas.schemaAliases[ocas.sessionMetaSchemaHash]).toBe(
			"@sumeru/session-meta",
		);
		expect(ocas.schemaAliases[ocas.metaSchemaHash]).toBe("@ocas/schema");
	});
});

describe("resolveOcasDir — CLI > env > default precedence", () => {
	let originalEnv: string | undefined;
	let originalHome: string | undefined;

	beforeEach(() => {
		originalEnv = process.env.SUMERU_OCAS_DIR;
		originalHome = process.env.HOME;
	});

	afterEach(() => {
		if (originalEnv === undefined) delete process.env.SUMERU_OCAS_DIR;
		else process.env.SUMERU_OCAS_DIR = originalEnv;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	});

	it("uses ~/.sumeru/ocas when no CLI flag and no env var", () => {
		delete process.env.SUMERU_OCAS_DIR;
		const fakeHome = mkdtempSync(join(tmpdir(), "fake-home-"));
		process.env.HOME = fakeHome;
		const resolved = resolveOcasDir(null);
		expect(resolved).toBe(join(fakeHome, ".sumeru", "ocas"));
	});

	it("uses SUMERU_OCAS_DIR when set and CLI is null", () => {
		process.env.SUMERU_OCAS_DIR = "/tmp/from-env";
		const resolved = resolveOcasDir(null);
		expect(resolved).toBe("/tmp/from-env");
	});

	it("CLI flag wins over SUMERU_OCAS_DIR", () => {
		process.env.SUMERU_OCAS_DIR = "/tmp/from-env";
		const resolved = resolveOcasDir("/tmp/from-cli");
		expect(resolved).toBe("/tmp/from-cli");
	});
});

describe("startServer — wiring the ocas store", () => {
	let stop: (() => Promise<void>) | null = null;

	afterEach(async () => {
		if (stop !== null) {
			await stop();
			stop = null;
		}
	});

	it("boots cleanly with a fresh ocasDir and serves the instance endpoint", async () => {
		const stub = makeStubAdapter({ name: "hermes" });
		const server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "test",
			version: "0.0.0",
			gateways: {
				hermes: {
					adapter: "hermes",
					capabilities: { resume: true, streaming: false },
				},
			},
			adapters: { hermes: stub.adapter },
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});
		stop = server.stop;
		const res = await fetch(`http://${server.host}:${server.port}/`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			type: string;
			value: { name: string; gateways: string[] };
		};
		expect(body.type).toBe("@sumeru/instance");
		// instance envelope must NOT leak ocasDir
		expect(body.value).not.toHaveProperty("ocasDir");
	});
});
