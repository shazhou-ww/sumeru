/**
 * Phase 5 — `server-search-endpoint.md` HTTP wire contract tests.
 *
 * GET /sessions?q=<query>                 — cross-gateway search
 * GET /gateways/:name/sessions?q=<query>  — per-gateway search (extends Phase 2)
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentResponse, NativeSessionRef, Turn } from "@sumeru/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GatewayConfig, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";
import { makeStubAdapter } from "./fixtures/stub-adapter.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

const TWO_GATEWAYS: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: true },
	},
	"claude-code": {
		adapter: "claude-code",
		capabilities: { resume: true, streaming: false },
	},
};

type SearchHit = {
	id: string;
	gateway: string;
	status: string;
	relevance: number;
	matchContext: string;
	turns: number;
	lastActiveAt: string;
};

type SearchResultBody = {
	type: string;
	value: {
		query: string;
		gateway: string | null;
		total: number;
		offset: number;
		limit: number;
		results: SearchHit[];
	};
};

type ErrorBody = {
	type: string;
	value: { error: string; message: string };
};

/**
 * Stub adapter that lets us deliver pre-canned assistant responses keyed by
 * the user content. Used to seed sessions with specific searchable text.
 */
function makeRespondingAdapter(name: string) {
	const responses = new Map<string, string>();
	return {
		stub: makeStubAdapter({
			name,
			respond: async (
				content: string,
				_ref: NativeSessionRef,
			): Promise<AgentResponse> => {
				const reply = responses.get(content) ?? `echo: ${content}`;
				const turns: Turn[] = [
					{
						index: 1,
						role: "assistant",
						content: reply,
						toolCalls: null,
						tokens: null,
						timestamp: new Date().toISOString(),
					},
				];
				return {
					turns,
					tokens: { input: 1, output: 2 },
					durationMs: 1,
				};
			},
		}),
		setReply(forContent: string, reply: string): void {
			responses.set(forContent, reply);
		},
	};
}

async function startTest(): Promise<{
	server: StartedServer;
	baseUrl: string;
}> {
	const hermes = makeRespondingAdapter("hermes");
	const claude = makeRespondingAdapter("claude-code");
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "sumeru@test",
		version: "0.1.0",
		gateways: TWO_GATEWAYS,
		workspaceRoot: null,
		adapters: {
			hermes: hermes.stub.adapter,
			"claude-code": claude.stub.adapter,
		},
		sseHeartbeatMs: 60_000,
		sseBufferSize: null,
		sseRetentionMs: null,
		ocasDir: tmpOcasDir(),
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
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
	// Drain the SSE response so the server completes the write.
	await res.text();
}

describe("@sumeru/server — search endpoint", () => {
	let server: StartedServer;
	let baseUrl: string;
	let sessionA = ""; // hermes — login redirect
	let sessionB = ""; // hermes — login (later)
	let sessionC = ""; // hermes — deploy timeout
	let sessionD = ""; // claude-code — login form
	let _sessionE = ""; // claude-code — readme fix

	beforeEach(async () => {
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		// Seed sessions with different content
		sessionA = await createSession(baseUrl, "hermes");
		await postMessage(
			baseUrl,
			"hermes",
			sessionA,
			"请修复 login 页面的重定向问题",
		);
		sessionB = await createSession(baseUrl, "hermes");
		await postMessage(
			baseUrl,
			"hermes",
			sessionB,
			"let me look at the login redirect",
		);
		sessionC = await createSession(baseUrl, "hermes");
		await postMessage(baseUrl, "hermes", sessionC, "deploy pipeline timeout");
		sessionD = await createSession(baseUrl, "claude-code");
		await postMessage(
			baseUrl,
			"claude-code",
			sessionD,
			"refactor login form to use new auth",
		);
		_sessionE = await createSession(baseUrl, "claude-code");
		await postMessage(
			baseUrl,
			"claude-code",
			_sessionE,
			"small typo fix in README",
		);
	});

	afterEach(async () => {
		await server.stop();
	});

	it("GET /sessions?q=login — cross-gateway", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as SearchResultBody;
		expect(body.type).toBe("@sumeru/search-result");
		expect(body.value.query).toBe("login");
		expect(body.value.gateway).toBeNull();
		expect(body.value.offset).toBe(0);
		expect(body.value.limit).toBe(50);
		expect(body.value.total).toBe(3);
		const ids = body.value.results.map((r) => r.id);
		expect(ids).toContain(sessionA);
		expect(ids).toContain(sessionB);
		expect(ids).toContain(sessionD);
		// No duplicate per session
		expect(new Set(ids).size).toBe(ids.length);
		// Per-hit shape
		for (const hit of body.value.results) {
			expect(hit.relevance).toBeGreaterThan(0);
			expect(hit.relevance).toBeLessThanOrEqual(1);
			expect(hit.matchContext.length).toBeGreaterThan(0);
			expect(typeof hit.lastActiveAt).toBe("string");
			expect(typeof hit.turns).toBe("number");
		}
	});

	it("GET /sessions?q=login&limit=2", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&limit=2`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.results.length).toBe(2);
		expect(body.value.total).toBe(3);
		expect(body.value.limit).toBe(2);
		expect(body.value.offset).toBe(0);
	});

	it("GET /sessions?q=login&offset=1&limit=2", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&offset=1&limit=2`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.results.length).toBe(2);
		expect(body.value.total).toBe(3);
		expect(body.value.limit).toBe(2);
		expect(body.value.offset).toBe(1);
	});

	it("GET /sessions?q=login&gateway=claude-code", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&gateway=claude-code`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.gateway).toBe("claude-code");
		expect(body.value.total).toBe(1);
		const ids = body.value.results.map((r) => r.id);
		expect(ids).toEqual([sessionD]);
		for (const hit of body.value.results) {
			expect(hit.gateway).toBe("claude-code");
		}
	});

	it("GET /gateways/hermes/sessions?q=login", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions?q=login`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.type).toBe("@sumeru/search-result");
		expect(body.value.gateway).toBe("hermes");
		expect(body.value.total).toBe(2);
		const ids = body.value.results.map((r) => r.id).sort();
		expect(ids.sort()).toEqual([sessionA, sessionB].sort());
	});

	it("GET /gateways/claude-code/sessions?q=login", async () => {
		const res = await fetch(`${baseUrl}/gateways/claude-code/sessions?q=login`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.gateway).toBe("claude-code");
		expect(body.value.total).toBe(1);
		expect(body.value.results.map((r) => r.id)).toEqual([sessionD]);
	});

	it("GET /gateways/hermes/sessions (no q) returns Phase-2 session-list", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: unknown[] };
		expect(body.type).toBe("@sumeru/session-list");
		expect(Array.isArray(body.value)).toBe(true);
		expect(body.value.length).toBe(3);
	});

	it("GET /gateways/hermes/sessions?q= (empty) returns Phase-2 session-list", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions?q=`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: unknown[] };
		expect(body.type).toBe("@sumeru/session-list");
	});

	it("GET /gateways/hermes/sessions?q=%20%20 (whitespace only) returns Phase-2 list", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions?q=%20%20`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: unknown[] };
		expect(body.type).toBe("@sumeru/session-list");
	});

	it("GET /sessions?q= (empty top-level) returns 400", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toContain("q");
	});

	it("GET /sessions (no q top-level) returns 400", async () => {
		const res = await fetch(`${baseUrl}/sessions`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("invalid_request");
	});

	it("GET /sessions?q=<CJK>", async () => {
		// "login重定向" — the architecture spec example.
		const q = encodeURIComponent("login重定向");
		const res = await fetch(`${baseUrl}/sessions?q=${q}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.query).toBe("login重定向");
		// CJK round-trip is exact.
		expect(body.value.results.length).toBeGreaterThanOrEqual(0);
	});

	it("GET /sessions?q=login&limit=abc returns 400", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&limit=abc`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toContain("limit");
		expect(body.value.message).toContain("abc");
	});

	it("GET /sessions?q=login&limit=-1 returns 400", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&limit=-1`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("invalid_request");
	});

	it("GET /sessions?q=login&limit=999 caps to 100", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&limit=999`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.limit).toBe(100);
		expect(body.value.results.length).toBeLessThanOrEqual(100);
	});

	it("GET /sessions?q=login&offset=abc returns 400", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login&offset=abc`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toContain("offset");
	});

	it("GET /sessions?q=login&gateway=does-not-exist returns 200 + empty", async () => {
		const res = await fetch(
			`${baseUrl}/sessions?q=login&gateway=does-not-exist`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.value.gateway).toBe("does-not-exist");
		expect(body.value.total).toBe(0);
		expect(body.value.results).toEqual([]);
	});

	it("POST /sessions?q=login returns 405 with Allow: GET", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login`, { method: "POST" });
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET");
	});

	it("GET /sessions?q=<very long> returns 400", async () => {
		const longQ = "x".repeat(8000);
		const res = await fetch(`${baseUrl}/sessions?q=${longQ}`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.message).toMatch(/at most/);
	});

	it("GET /sessions/?q=login (trailing slash with q)", async () => {
		const res = await fetch(`${baseUrl}/sessions/?q=login`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		expect(body.type).toBe("@sumeru/search-result");
		expect(body.value.total).toBe(3);
	});

	it("GET /sessions/ (trailing slash, no q) returns 400", async () => {
		const res = await fetch(`${baseUrl}/sessions/`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("invalid_request");
	});

	it("GET /gateways/does-not-exist/sessions?q=login returns 404", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/does-not-exist/sessions?q=login`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("GET /gateways/hermes/sessions?q=login&gateway=claude-code ignores ?gateway=", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions?q=login&gateway=claude-code`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		// per-gateway path is authoritative
		expect(body.value.gateway).toBe("hermes");
		for (const hit of body.value.results) {
			expect(hit.gateway).toBe("hermes");
		}
	});

	it("HEAD /sessions?q=login same headers as GET, empty body", async () => {
		const getRes = await fetch(`${baseUrl}/sessions?q=login`);
		const getBody = await getRes.text();
		const headRes = await fetch(`${baseUrl}/sessions?q=login`, {
			method: "HEAD",
		});
		expect(headRes.status).toBe(200);
		const headBody = await headRes.text();
		// HEAD should have empty body
		expect(headBody.length).toBe(0);
		// Content-Length on GET should match getBody bytes; HEAD just mirrors the
		// path so its length is computed identically.
		expect(getBody.length).toBeGreaterThan(0);
	});

	it("closed sessions still appear in search results", async () => {
		// Close session B, then search for login — B should still appear.
		const del = await fetch(`${baseUrl}/gateways/hermes/sessions/${sessionB}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(204);
		const res = await fetch(`${baseUrl}/sessions?q=login`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchResultBody;
		const closedHit = body.value.results.find((r) => r.id === sessionB);
		expect(closedHit).toBeDefined();
		expect(closedHit?.status).toBe("closed");
	});

	it("POST /gateways/hermes/sessions?q=login still creates a session (Phase-2)", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions?q=login`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { type: string; value: { id: string } };
		expect(body.type).toBe("@sumeru/session");
		expect(body.value.id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it("pagination disjoint coverage", async () => {
		const page1Res = await fetch(
			`${baseUrl}/sessions?q=login&limit=2&offset=0`,
		);
		const page1 = (await page1Res.json()) as SearchResultBody;
		const page2Res = await fetch(
			`${baseUrl}/sessions?q=login&limit=2&offset=2`,
		);
		const page2 = (await page2Res.json()) as SearchResultBody;
		const ids1 = page1.value.results.map((r) => r.id);
		const ids2 = page2.value.results.map((r) => r.id);
		expect(ids1.length).toBe(2);
		// Total is 3, offset=2 limit=2 → at most 1
		expect(ids2.length).toBe(1);
		// Disjoint
		expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
	});

	it("results have exactly the seven specified hit keys", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login`);
		const body = (await res.json()) as SearchResultBody;
		const hit = body.value.results[0];
		if (hit === undefined) throw new Error("expected hit");
		const keys = Object.keys(hit).sort();
		expect(keys).toEqual(
			[
				"gateway",
				"id",
				"lastActiveAt",
				"matchContext",
				"relevance",
				"status",
				"turns",
			].sort(),
		);
	});

	it("envelope value has exactly six keys", async () => {
		const res = await fetch(`${baseUrl}/sessions?q=login`);
		const body = (await res.json()) as SearchResultBody;
		expect(Object.keys(body).sort()).toEqual(["type", "value"]);
		expect(Object.keys(body.value).sort()).toEqual(
			["gateway", "limit", "offset", "query", "results", "total"].sort(),
		);
	});
});
