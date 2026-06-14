/**
 * Phase 4 — `server-ocas-object-endpoint.md`.
 *
 * Asserts the GET /ocas/:hash contract for valid hashes (turn, session-meta,
 * schema), invalid hashes, missing routes, and method enforcement.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type GatewayConfig,
	openSumeruOcas,
	type StartedServer,
	startServer,
} from "../src/index.js";
import { makeStubAdapter } from "./fixtures/stub-adapter.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

const HERMES_GATEWAY: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: false },
	},
};

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

async function startTest(): Promise<{
	server: StartedServer;
	baseUrl: string;
	ocasDir: string;
}> {
	const stub = makeStubAdapter({ name: "hermes" });
	const ocasDir = tmpOcasDir();
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "test",
		version: "0.0.0",
		gateways: HERMES_GATEWAY,
		adapters: { hermes: stub.adapter },
		sseHeartbeatMs: null,
		sseBufferSize: null,
		sseRetentionMs: null,
		ocasDir,
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
		ocasDir,
	};
}

describe("GET /ocas/:hash — schema retrieval", () => {
	let server: StartedServer;
	let baseUrl: string;
	let ocasDir: string;

	beforeEach(async () => {
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		ocasDir = ctx.ocasDir;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("returns @ocas/schema envelope for the @sumeru/turn schema hash", async () => {
		const ocas = openSumeruOcas(ocasDir);
		const res = await fetch(`${baseUrl}/ocas/${ocas.turnSchemaHash}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/application\/json/);
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(res.headers.get("etag")).toBe(`"${ocas.turnSchemaHash}"`);
		const body = (await res.json()) as {
			type: string;
			value: { title: string };
		};
		expect(body.type).toBe("@ocas/schema");
		expect(body.value.title).toBe("@sumeru/turn");
	});

	it("returns @ocas/schema envelope for the @sumeru/session-meta schema hash", async () => {
		const ocas = openSumeruOcas(ocasDir);
		const res = await fetch(`${baseUrl}/ocas/${ocas.sessionMetaSchemaHash}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			type: string;
			value: { title: string };
		};
		expect(body.type).toBe("@ocas/schema");
		expect(body.value.title).toBe("@sumeru/session-meta");
	});

	it("supports If-None-Match → 304 with empty body", async () => {
		const ocas = openSumeruOcas(ocasDir);
		const res = await fetch(`${baseUrl}/ocas/${ocas.turnSchemaHash}`, {
			headers: { "if-none-match": `"${ocas.turnSchemaHash}"` },
		});
		expect(res.status).toBe(304);
		const text = await res.text();
		expect(text).toBe("");
	});
});

describe("GET /ocas/:hash — error paths", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("404 ocas_not_found for a valid-format hash that is not stored", async () => {
		const res = await fetch(`${baseUrl}/ocas/0000000000000`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			type: string;
			value: { error: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("ocas_not_found");
	});

	it("400 invalid_hash for a malformed hash", async () => {
		const res = await fetch(`${baseUrl}/ocas/not-a-hash`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			type: string;
			value: { error: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("invalid_hash");
	});

	it("400 invalid_hash for a lowercase hash (alphabet is uppercase only)", async () => {
		const res = await fetch(`${baseUrl}/ocas/abcdefghjkmnp`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("invalid_hash");
	});

	it("404 route_not_found for /ocas/ (empty hash)", async () => {
		const res = await fetch(`${baseUrl}/ocas/`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("route_not_found");
	});

	it("404 not_found for /ocas (no trailing slash)", async () => {
		const res = await fetch(`${baseUrl}/ocas`);
		expect(res.status).toBe(404);
	});

	it("404 for /ocas/<hash>/extra (too many segments)", async () => {
		const res = await fetch(`${baseUrl}/ocas/0000000000000/extra`);
		expect(res.status).toBe(404);
	});

	it("405 method_not_allowed for POST /ocas/<hash>", async () => {
		const res = await fetch(`${baseUrl}/ocas/0000000000000`, {
			method: "POST",
		});
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET");
	});
});

describe("GET /ocas/:hash — round-trip session meta", () => {
	let server: StartedServer;
	let baseUrl: string;
	let ocasDir: string;

	beforeEach(async () => {
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		ocasDir = ctx.ocasDir;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("session create → ocas store carries the meta and /ocas/:hash returns it", async () => {
		const created = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ config: { model: "x" } }),
		});
		const body = (await created.json()) as {
			value: { id: string; createdAt: string };
		};
		const ocas = openSumeruOcas(ocasDir);
		const expected = {
			id: body.value.id,
			gateway: "hermes",
			adapter: "hermes",
			createdAt: body.value.createdAt,
			config: { model: "x" },
		};
		const hash = ocas.store.cas.put(ocas.sessionMetaSchemaHash, expected);
		expect(hash).toMatch(HASH_RE);
		const res = await fetch(`${baseUrl}/ocas/${hash}`);
		expect(res.status).toBe(200);
		const env = (await res.json()) as { type: string; value: unknown };
		expect(env.type).toBe("@sumeru/session-meta");
		expect(env.value).toEqual(expected);
	});
});
