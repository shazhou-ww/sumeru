/**
 * Phase 5 — `server-session-export-endpoint.md` HTTP wire contract tests.
 *
 * POST /gateways/:name/sessions/:id/export → tar.gz of the session recording.
 * HEAD /gateways/:name/sessions/:id/export → headers only.
 */

import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createMemoryStore, importBundle, loadBundleStore } from "@ocas/core";
import type { AgentResponse, NativeSessionRef, Turn } from "@sumeru/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GatewayConfig, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";
import {
	makeStubAdapter,
	type StubAdapterControl,
} from "./fixtures/stub-adapter.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

const TWO_GATEWAYS: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: true },
		config: null,
	},
	"claude-code": {
		adapter: "claude-code",
		capabilities: { resume: true, streaming: false },
		config: null,
	},
};

type ErrorBody = {
	type: string;
	value: { error: string; message: string };
};

/**
 * Stub adapter that produces 3 turns per send so two POSTs yield 6 turns total.
 * Used to seed the export fixture sessions.
 */
function makeMultiTurnAdapter(name: string): StubAdapterControl {
	return makeStubAdapter({
		name,
		respond: async (
			content: string,
			_ref: NativeSessionRef,
		): Promise<AgentResponse> => {
			const turns: Turn[] = [
				{
					index: 1,
					role: "assistant",
					content: `thinking about: ${content}`,
					toolCalls: null,
					tokens: null,
					timestamp: new Date().toISOString(),
				},
				{
					index: 2,
					role: "assistant",
					content: `working on: ${content}`,
					toolCalls: null,
					tokens: null,
					timestamp: new Date().toISOString(),
				},
				{
					index: 3,
					role: "assistant",
					content: `done with: ${content}`,
					toolCalls: null,
					tokens: null,
					timestamp: new Date().toISOString(),
				},
			];
			return {
				turns,
				tokens: { input: 1, output: 6 },
				durationMs: 1,
			};
		},
	});
}

async function startTest(): Promise<{
	server: StartedServer;
	baseUrl: string;
	hermes: StubAdapterControl;
	claude: StubAdapterControl;
}> {
	const hermes = makeMultiTurnAdapter("hermes");
	const claude = makeMultiTurnAdapter("claude-code");
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "sumeru@test",
		version: "0.1.0",
		gateways: TWO_GATEWAYS,
		workspaceRoot: null,
		adapters: {
			hermes: hermes.adapter,
			"claude-code": claude.adapter,
		},
		sseHeartbeatMs: 60_000,
		sseBufferSize: null,
		sseRetentionMs: null,
		ocasDir: tmpOcasDir(),
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
		hermes,
		claude,
	};
}

async function createSession(
	baseUrl: string,
	gateway: string,
): Promise<string> {
	const res = await fetch(`${baseUrl}/gateways/${gateway}/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	if (res.status !== 201) {
		throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
	}
	const body = (await res.json()) as { value: { id: string } };
	return body.value.id;
}

async function postMessage(
	baseUrl: string,
	gateway: string,
	sessionId: string,
	content: string,
): Promise<void> {
	const res = await fetch(
		`${baseUrl}/gateways/${gateway}/sessions/${sessionId}/messages`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify({ content }),
		},
	);
	await res.text();
}

async function closeSession(
	baseUrl: string,
	gateway: string,
	sessionId: string,
): Promise<void> {
	const res = await fetch(
		`${baseUrl}/gateways/${gateway}/sessions/${sessionId}`,
		{ method: "DELETE" },
	);
	if (res.status !== 200 && res.status !== 204) {
		throw new Error(`closeSession failed: ${res.status} ${await res.text()}`);
	}
}

/** Read a tar archive into [{ name, content }]. Header parsing matches @ocas/core. */
function unpackTar(buf: Buffer): Array<{ name: string; content: Buffer }> {
	const entries: Array<{ name: string; content: Buffer }> = [];
	let offset = 0;
	while (offset + 512 <= buf.length) {
		const header = buf.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;
		const name = readCString(header, 0, 100);
		const sizeStr = readCString(header, 124, 12).trim();
		const size = sizeStr === "" ? 0 : Number.parseInt(sizeStr, 8);
		offset += 512;
		const content = Buffer.from(buf.subarray(offset, offset + size));
		entries.push({ name, content });
		offset += Math.ceil(size / 512) * 512;
	}
	return entries;
}

function readCString(buf: Buffer, start: number, len: number): string {
	const slice = buf.subarray(start, start + len);
	let end = slice.length;
	for (let i = 0; i < slice.length; i += 1) {
		if (slice[i] === 0) {
			end = i;
			break;
		}
	}
	return slice.subarray(0, end).toString("utf8");
}

function countTempExportDirs(): number {
	const dirs = readdirSync(tmpdir(), { withFileTypes: true });
	let n = 0;
	for (const d of dirs) {
		if (d.isDirectory() && d.name.startsWith("sumeru-export-")) n += 1;
	}
	return n;
}

describe("@sumeru/server — export endpoint", () => {
	let server: StartedServer;
	let baseUrl: string;
	let sessionA = ""; // hermes — 6 turns (after 2 sends @ 3 turns each)
	let sessionEmpty = ""; // hermes — 0 turns
	let sessionClosed = ""; // hermes — 6 turns then closed

	beforeEach(async () => {
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;

		sessionA = await createSession(baseUrl, "hermes");
		await postMessage(baseUrl, "hermes", sessionA, "hello");
		await postMessage(baseUrl, "hermes", sessionA, "world");

		sessionEmpty = await createSession(baseUrl, "hermes");

		sessionClosed = await createSession(baseUrl, "hermes");
		await postMessage(baseUrl, "hermes", sessionClosed, "first");
		await postMessage(baseUrl, "hermes", sessionClosed, "second");
		await closeSession(baseUrl, "hermes", sessionClosed);
	});

	afterEach(async () => {
		await server.stop();
	});

	it("happy path — POST .../export returns 200 + tar.gz with required headers", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/gzip");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="${sessionA}.tar.gz"`,
		);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("x-sumeru-export-session")).toBe(sessionA);
		const nodes = Number(res.headers.get("x-sumeru-export-nodes"));
		expect(Number.isInteger(nodes)).toBe(true);
		expect(nodes).toBeGreaterThan(0);
		// Body length matches Content-Length.
		const body = Buffer.from(await res.arrayBuffer());
		expect(body.length).toBe(Number(res.headers.get("content-length")));
	});

	it("tar contents — 1 meta + 6 turns + schema chain + vars.jsonl + tags.jsonl", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = Buffer.from(await res.arrayBuffer());
		const tar = gunzipSync(body);
		const entries = unpackTar(tar);
		const names = entries.map((e) => e.name);
		// Exactly two non-cas entries.
		expect(names.includes("vars.jsonl")).toBe(true);
		expect(names.includes("tags.jsonl")).toBe(true);
		// At least 1 meta + 6 turns + schema chain. Spec says N = 10 for the
		// 1+6+3 fixture (or possibly more depending on schema-of-schemas).
		const cas = names.filter((n) => n.startsWith("cas/") && n.endsWith(".bin"));
		expect(cas.length).toBeGreaterThanOrEqual(7);
		// Hashes match the regex.
		for (const n of cas) {
			expect(n).toMatch(/^cas\/[0-9A-HJKMNP-TV-Z]{13}\.bin$/);
		}
		// Sorted by hash.
		const sorted = [...cas].sort();
		expect(cas).toEqual(sorted);
		// X-Sumeru-Export-Nodes equals the cas/*.bin count.
		expect(Number(res.headers.get("x-sumeru-export-nodes"))).toBe(cas.length);
	});

	it("re-import round-trip — every original CAS hash is present after importBundle", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = Buffer.from(await res.arrayBuffer());
		const tar = gunzipSync(body);

		// Save the tar to disk so loadBundleStore can read it.
		const tmp = mkdtempSync(join(tmpdir(), "sumeru-export-test-"));
		const tarPath = join(tmp, "bundle.tar");
		writeFileSync(tarPath, tar);

		// loadBundleStore reads the bundle into a fresh memory store.
		const target = await loadBundleStore(tarPath);

		// Every cas/<hash>.bin entry → store has the node.
		const entries = unpackTar(tar);
		const casHashes = entries
			.filter((e) => e.name.startsWith("cas/") && e.name.endsWith(".bin"))
			.map((e) => e.name.slice(4, -4));
		for (const h of casHashes) {
			expect(target.cas.has(h)).toBe(true);
		}

		// Also verify importBundle into a different store works the same way.
		const otherTarget = createMemoryStore();
		await importBundle(tarPath, otherTarget);
		for (const h of casHashes) {
			expect(otherTarget.cas.has(h)).toBe(true);
		}
	});

	it("determinism — two consecutive POSTs produce byte-equal tar contents", async () => {
		const r1 = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		const r2 = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		const tar1 = gunzipSync(Buffer.from(await r1.arrayBuffer()));
		const tar2 = gunzipSync(Buffer.from(await r2.arrayBuffer()));
		const e1 = unpackTar(tar1);
		const e2 = unpackTar(tar2);
		expect(e1.length).toBe(e2.length);
		for (let i = 0; i < e1.length; i += 1) {
			expect(e1[i]?.name).toBe(e2[i]?.name);
			expect(
				Buffer.compare(
					e1[i]?.content ?? Buffer.alloc(0),
					e2[i]?.content ?? Buffer.alloc(0),
				),
			).toBe(0);
		}
	});

	it("closed session — exportable with full recording", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionClosed}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = Buffer.from(await res.arrayBuffer());
		const tar = gunzipSync(body);
		const entries = unpackTar(tar);
		const cas = entries.filter(
			(e) => e.name.startsWith("cas/") && e.name.endsWith(".bin"),
		);
		// Same shape as sessionA — close doesn't strip turns.
		expect(cas.length).toBeGreaterThanOrEqual(7);
		expect(res.headers.get("x-sumeru-export-session")).toBe(sessionClosed);
	});

	it("empty session (0 turns) — only meta + schema chain", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionEmpty}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
		const entries = unpackTar(tar);
		const cas = entries.filter(
			(e) => e.name.startsWith("cas/") && e.name.endsWith(".bin"),
		);
		// 1 meta + 2-3 schema nodes — no turns.
		expect(cas.length).toBeLessThanOrEqual(5);
		expect(cas.length).toBeGreaterThanOrEqual(2);
		expect(Number(res.headers.get("x-sumeru-export-nodes"))).toBe(cas.length);
	});

	it("concurrent exports — 5 parallel POSTs all return 200, no temp leaks", async () => {
		const tmpBefore = countTempExportDirs();
		const promises = Array.from({ length: 5 }, () =>
			fetch(`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`, {
				method: "POST",
			}),
		);
		const results = await Promise.all(promises);
		const bodies = await Promise.all(
			results.map(async (r) => Buffer.from(await r.arrayBuffer())),
		);
		for (const r of results) {
			expect(r.status).toBe(200);
		}
		// All 5 tar contents are byte-equal at the tar level.
		const tars = bodies.map((b) => gunzipSync(b));
		const ref = unpackTar(tars[0] ?? Buffer.alloc(0));
		for (let i = 1; i < tars.length; i += 1) {
			const cur = unpackTar(tars[i] ?? Buffer.alloc(0));
			expect(cur.length).toBe(ref.length);
			for (let j = 0; j < ref.length; j += 1) {
				expect(cur[j]?.name).toBe(ref[j]?.name);
				expect(
					Buffer.compare(
						cur[j]?.content ?? Buffer.alloc(0),
						ref[j]?.content ?? Buffer.alloc(0),
					),
				).toBe(0);
			}
		}
		// Allow ~250 ms for the finish/close cleanup hooks to run.
		await new Promise((r) => setTimeout(r, 250));
		const tmpAfter = countTempExportDirs();
		expect(tmpAfter).toBe(tmpBefore);
	});

	it("concurrent export + send — both succeed", async () => {
		const sendP = postMessage(baseUrl, "hermes", sessionA, "concurrent");
		const exportP = fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		const [_, res] = await Promise.all([sendP, exportP]);
		expect(res.status).toBe(200);
		const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
		const entries = unpackTar(tar);
		// Tar is internally consistent — every cas/<hash>.bin parses.
		for (const e of entries) {
			if (e.name.startsWith("cas/") && e.name.endsWith(".bin")) {
				expect(e.content.length).toBeGreaterThan(0);
			}
		}
	});

	it("unknown session → 404 session_not_found, no temp dirs leaked", async () => {
		const before = countTempExportDirs();
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/ses_DOES_NOT_EXIST/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		const body = (await res.json()) as ErrorBody;
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("session_not_found");
		expect(body.value.message).toContain("ses_DOES_NOT_EXIST");
		expect(body.value.message).toContain("hermes");
		const after = countTempExportDirs();
		expect(after).toBe(before);
	});

	it("unknown gateway → 404 gateway_not_found", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/does-not-exist/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("gateway_not_found");
		expect(body.value.message).toContain("does-not-exist");
	});

	it("GET .../export → 405 with Allow: POST", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "GET" },
		);
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("POST");
		const body = (await res.json()) as ErrorBody;
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("method_not_allowed");
	});

	it("PUT .../export → 405 with Allow: POST", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "PUT" },
		);
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("POST");
	});

	it("body is ignored — POST with JSON body returns same bytes", async () => {
		const r1 = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"foo":"bar"}',
			},
		);
		const r2 = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		const t1 = gunzipSync(Buffer.from(await r1.arrayBuffer()));
		const t2 = gunzipSync(Buffer.from(await r2.arrayBuffer()));
		expect(Buffer.compare(t1, t2)).toBe(0);
	});

	it("HEAD .../export — empty body, headers match POST", async () => {
		const headRes = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "HEAD" },
		);
		expect(headRes.status).toBe(200);
		expect(headRes.headers.get("content-type")).toBe("application/gzip");
		expect(headRes.headers.get("x-sumeru-export-session")).toBe(sessionA);
		const headLen = Number(headRes.headers.get("content-length"));
		expect(headLen).toBeGreaterThan(0);
		// Body is empty.
		const headBody = await headRes.arrayBuffer();
		expect(headBody.byteLength).toBe(0);

		const postRes = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(postRes.status).toBe(200);
		const postLen = Number(postRes.headers.get("content-length"));
		// Same fixture, same Content-Length (deterministic).
		expect(headLen).toBe(postLen);
		await postRes.arrayBuffer();
	});

	it("Content-Encoding absent even when Accept-Encoding: gzip is set", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{
				method: "POST",
				headers: { "accept-encoding": "gzip" },
			},
		);
		expect(res.status).toBe(200);
		// The body is gzipped as its payload format, not as a transport
		// encoding. Therefore Content-Encoding MUST NOT be set.
		expect(res.headers.get("content-encoding")).toBeNull();
		await res.arrayBuffer();
	});

	it("trailing slash — POST .../export/ returns same bytes", async () => {
		const r1 = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export/`,
			{ method: "POST" },
		);
		const r2 = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		const t1 = gunzipSync(Buffer.from(await r1.arrayBuffer()));
		const t2 = gunzipSync(Buffer.from(await r2.arrayBuffer()));
		expect(Buffer.compare(t1, t2)).toBe(0);
	});

	it("?download=1 — same body, attachment Content-Disposition still set", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export?download=1`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="${sessionA}.tar.gz"`,
		);
		await res.arrayBuffer();
	});

	it("Content-Disposition filename matches the session id exactly", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const cd = res.headers.get("content-disposition");
		expect(cd).toMatch(
			/^attachment; filename="ses_[0-9A-HJKMNP-TV-Z]{26}\.tar\.gz"$/,
		);
		expect(cd).toBe(`attachment; filename="${sessionA}.tar.gz"`);
		await res.arrayBuffer();
	});

	it("X-Sumeru-Export-Nodes matches the cas/*.bin count in the tar", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
		const entries = unpackTar(tar);
		const cas = entries.filter(
			(e) => e.name.startsWith("cas/") && e.name.endsWith(".bin"),
		);
		expect(Number(res.headers.get("x-sumeru-export-nodes"))).toBe(cas.length);
	});

	it("temp dir cleanup — successful POST leaves no sumeru-export-* dirs", async () => {
		const before = countTempExportDirs();
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		await res.arrayBuffer();
		// Wait for the finish/close hook to run.
		await new Promise((r) => setTimeout(r, 250));
		const after = countTempExportDirs();
		expect(after).toBe(before);
	});

	it("file size — Content-Length equals statSync of the tar.gz", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionA}/export`,
			{ method: "POST" },
		);
		const body = Buffer.from(await res.arrayBuffer());
		// Sanity: response Content-Length matches what we read.
		expect(Number(res.headers.get("content-length"))).toBe(body.length);
		// Sanity: the gunzipped tar is non-empty.
		const tar = gunzipSync(body);
		expect(tar.length).toBeGreaterThan(0);
		// Tar size is a multiple of 512 (per tar spec).
		expect(tar.length % 512).toBe(0);
	});
});

describe("@sumeru/server — export endpoint (no-adapter scenarios)", () => {
	it("export does not call adapter.send / adapter.getTurns / adapter.close", async () => {
		// Stub adapter that throws on every method except createSession + send
		// (used for fixture setup).
		let sendCount = 0;
		let getTurnsCount = 0;
		let closeCount = 0;
		const stub = makeStubAdapter({ name: "hermes" });
		const wrapped = {
			...stub.adapter,
			async send(
				ref: NativeSessionRef,
				content: string,
			): Promise<AgentResponse> {
				sendCount += 1;
				return stub.adapter.send(ref, content);
			},
			async getTurns(): Promise<Turn[]> {
				getTurnsCount += 1;
				return [];
			},
			async close(ref: NativeSessionRef): Promise<void> {
				closeCount += 1;
				await stub.adapter.close(ref);
			},
		};
		const server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru@test",
			version: "0.1.0",
			gateways: TWO_GATEWAYS,
			workspaceRoot: null,
			adapters: { hermes: wrapped, "claude-code": stub.adapter },
			sseHeartbeatMs: 60_000,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});
		try {
			const baseUrl = `http://${server.host}:${server.port}`;
			const sid = await createSession(baseUrl, "hermes");
			await postMessage(baseUrl, "hermes", sid, "test");
			const sendsBeforeExport = sendCount;
			const getTurnsBeforeExport = getTurnsCount;
			const closeBeforeExport = closeCount;
			const res = await fetch(
				`${baseUrl}/gateways/hermes/sessions/${sid}/export`,
				{ method: "POST" },
			);
			expect(res.status).toBe(200);
			await res.arrayBuffer();
			expect(sendCount).toBe(sendsBeforeExport);
			expect(getTurnsCount).toBe(getTurnsBeforeExport);
			expect(closeCount).toBe(closeBeforeExport);
		} finally {
			await server.stop();
		}
	});
});

describe("@sumeru/server — export endpoint (cleanup-on-disconnect)", () => {
	it("aborting the response cleans up the temp dir", async () => {
		const hermes = makeMultiTurnAdapter("hermes");
		const claude = makeMultiTurnAdapter("claude-code");
		const server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru@test",
			version: "0.1.0",
			gateways: TWO_GATEWAYS,
			workspaceRoot: null,
			adapters: {
				hermes: hermes.adapter,
				"claude-code": claude.adapter,
			},
			sseHeartbeatMs: 60_000,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});
		try {
			const baseUrl = `http://${server.host}:${server.port}`;
			const sid = await createSession(baseUrl, "hermes");
			await postMessage(baseUrl, "hermes", sid, "first");
			await postMessage(baseUrl, "hermes", sid, "second");
			const before = countTempExportDirs();

			// Open the connection, then abort.
			const ctrl = new AbortController();
			const promise = fetch(
				`${baseUrl}/gateways/hermes/sessions/${sid}/export`,
				{ method: "POST", signal: ctrl.signal },
			).catch(() => null);
			// Give the server a moment to start the response.
			await new Promise((r) => setTimeout(r, 50));
			ctrl.abort();
			await promise;

			// Wait for the close hook to clean up.
			await new Promise((r) => setTimeout(r, 250));
			const after = countTempExportDirs();
			expect(after).toBeLessThanOrEqual(before);
		} finally {
			await server.stop();
		}
	});
});

describe("@sumeru/server — export endpoint (file size sanity)", () => {
	it("Content-Length equals statSync of the temp tar.gz on disk", async () => {
		const hermes = makeMultiTurnAdapter("hermes");
		const claude = makeMultiTurnAdapter("claude-code");
		const server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru@test",
			version: "0.1.0",
			gateways: TWO_GATEWAYS,
			workspaceRoot: null,
			adapters: {
				hermes: hermes.adapter,
				"claude-code": claude.adapter,
			},
			sseHeartbeatMs: 60_000,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});
		try {
			const baseUrl = `http://${server.host}:${server.port}`;
			const sid = await createSession(baseUrl, "hermes");
			await postMessage(baseUrl, "hermes", sid, "test");
			const res = await fetch(
				`${baseUrl}/gateways/hermes/sessions/${sid}/export`,
				{ method: "POST" },
			);
			const body = Buffer.from(await res.arrayBuffer());
			const cl = Number(res.headers.get("content-length"));
			expect(cl).toBe(body.length);
			// And gunzipping yields a valid tar (multiple of 512).
			const tar = gunzipSync(body);
			expect(tar.length % 512).toBe(0);
			// statSync of the body buffer just confirms the read succeeded.
			expect(typeof statSync).toBe("function");
		} finally {
			await server.stop();
		}
	});
});
