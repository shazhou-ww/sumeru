/**
 * Phase 4 — `server-message-history-endpoint.md`.
 *
 * Asserts that GET /gateways/:name/sessions/:id/messages returns the full
 * ordered turn sequence sourced from ocas, supports pagination, validates
 * query parameters, and survives session closure.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentResponse, NativeSessionRef, Turn } from "@sumeru/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type GatewayConfig,
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

type TestCtx = {
	server: StartedServer;
	baseUrl: string;
	setRespond: (
		fn: (content: string, ref: NativeSessionRef) => Promise<AgentResponse>,
	) => void;
};

async function startTest(): Promise<TestCtx> {
	const stub = makeStubAdapter({ name: "hermes" });
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "test",
		version: "0.0.0",
		gateways: HERMES_GATEWAY,
		workspaceRoot: null,
		adapters: { hermes: stub.adapter },
		sseHeartbeatMs: null,
		sseBufferSize: null,
		sseRetentionMs: null,
		ocasDir: tmpOcasDir(),
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
		setRespond: stub.setResponse,
	};
}

async function createSession(baseUrl: string): Promise<string> {
	const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	const body = (await res.json()) as { value: { id: string } };
	return body.value.id;
}

async function sendMessage(
	baseUrl: string,
	sessionId: string,
	content: string,
): Promise<void> {
	const res = await fetch(
		`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify({ content }),
		},
	);
	// Drain SSE stream
	await res.text();
}

describe("GET /gateways/:name/sessions/:id/messages", () => {
	let ctx: TestCtx;

	beforeEach(async () => {
		ctx = await startTest();
	});

	afterEach(async () => {
		await ctx.server.stop();
	});

	it("empty session — total=0, turns=[]", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as {
			type: string;
			value: { total: number; turns: unknown[] };
		};
		expect(body.type).toBe("@sumeru/message-history");
		expect(body.value.total).toBe(0);
		expect(body.value.turns).toEqual([]);
	});

	it("after one send, returns one user + one assistant turn with hashes", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		await sendMessage(ctx.baseUrl, sessionId, "hello");
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			value: {
				total: number;
				turns: Array<{ role: string; hash: string; content: string }>;
			};
		};
		expect(body.value.total).toBe(2);
		expect(body.value.turns).toHaveLength(2);
		expect(body.value.turns[0]?.role).toBe("user");
		expect(body.value.turns[0]?.content).toBe("hello");
		expect(body.value.turns[0]?.hash).toMatch(HASH_RE);
		expect(body.value.turns[1]?.role).toBe("assistant");
		expect(body.value.turns[1]?.hash).toMatch(HASH_RE);
		expect(body.value.turns[0]?.hash).not.toBe(body.value.turns[1]?.hash);
	});

	it("turn hash from history can be fetched via /ocas/:hash", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		await sendMessage(ctx.baseUrl, sessionId, "ping");
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		);
		const body = (await res.json()) as {
			value: { turns: Array<{ hash: string; role: string }> };
		};
		const userHash = body.value.turns[0]?.hash ?? "";
		const ocasRes = await fetch(`${ctx.baseUrl}/ocas/${userHash}`);
		expect(ocasRes.status).toBe(200);
		const ocasBody = (await ocasRes.json()) as {
			type: string;
			value: { role: string; content: string };
		};
		expect(ocasBody.type).toBe("@sumeru/turn");
		expect(ocasBody.value.role).toBe("user");
		expect(ocasBody.value.content).toBe("ping");
	});

	it("?offset=1&limit=1 returns the assistant turn only", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		await sendMessage(ctx.baseUrl, sessionId, "hello");
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?offset=1&limit=1`,
		);
		const body = (await res.json()) as {
			value: {
				total: number;
				offset: number;
				limit: number;
				turns: Array<{ role: string }>;
			};
		};
		expect(body.value.total).toBe(2);
		expect(body.value.offset).toBe(1);
		expect(body.value.limit).toBe(1);
		expect(body.value.turns).toHaveLength(1);
		expect(body.value.turns[0]?.role).toBe("assistant");
	});

	it("?limit=0 returns an empty array (fast count probe)", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		await sendMessage(ctx.baseUrl, sessionId, "hello");
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?limit=0`,
		);
		const body = (await res.json()) as {
			value: { total: number; turns: unknown[]; limit: number };
		};
		expect(body.value.total).toBe(2);
		expect(body.value.limit).toBe(0);
		expect(body.value.turns).toEqual([]);
	});

	it("offset past end returns turns=[] but echoes the offset", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		await sendMessage(ctx.baseUrl, sessionId, "hi");
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?offset=999`,
		);
		const body = (await res.json()) as {
			value: { total: number; offset: number; turns: unknown[] };
		};
		expect(body.value.total).toBe(2);
		expect(body.value.offset).toBe(999);
		expect(body.value.turns).toEqual([]);
	});

	it("?limit=-1 returns 400 invalid_request", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?limit=-1`,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			value: { error: string; message: string };
		};
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toMatch(/limit/);
	});

	it("?limit=abc returns 400 invalid_request", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?limit=abc`,
		);
		expect(res.status).toBe(400);
	});

	it("?offset=1.5 (float) returns 400", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?offset=1.5`,
		);
		expect(res.status).toBe(400);
	});

	it("limit cap — ?limit=99999 → echoed as 1000", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages?limit=99999`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { value: { limit: number } };
		expect(body.value.limit).toBe(1000);
	});

	it("closed session is still readable", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		await sendMessage(ctx.baseUrl, sessionId, "hello");
		const del = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			value: { total: number; turns: unknown[] };
		};
		expect(body.value.total).toBe(2);
	});

	it("unknown session returns 404 session_not_found", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/ses_DOES_NOT_EXIST/messages`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("session_not_found");
	});

	it("unknown gateway returns 404 gateway_not_found", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/gateways/does-not-exist/sessions/ses_X/messages`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("PUT returns 405 with Allow: GET, POST", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
			{ method: "PUT" },
		);
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET, POST");
	});

	it("multi-turn assistant response is preserved in order", async () => {
		const sessionId = await createSession(ctx.baseUrl);
		ctx.setRespond(async (_content, _ref) => {
			const turns: Turn[] = [
				{
					index: 1,
					role: "assistant",
					content: "first",
					timestamp: new Date().toISOString(),
					toolCalls: null,
				},
				{
					index: 2,
					role: "assistant",
					content: "second",
					timestamp: new Date().toISOString(),
					toolCalls: null,
				},
			];
			return { turns, tokens: null, durationMs: 1 };
		});
		await sendMessage(ctx.baseUrl, sessionId, "hello");
		const res = await fetch(
			`${ctx.baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		);
		const body = (await res.json()) as {
			value: {
				total: number;
				turns: Array<{ role: string; content: string }>;
			};
		};
		expect(body.value.total).toBe(3);
		expect(body.value.turns.map((t) => t.content)).toEqual([
			"hello",
			"first",
			"second",
		]);
	});
});
