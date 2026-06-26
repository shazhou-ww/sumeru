/**
 * SSE resume expiry tests — covers the behavior specified in
 * `specs/server-sse/server-sse-resume-expired-vs-missing.md`.
 *
 * Verifies the server distinguishes "buffer expired" (410 stream_expired) from
 * "buffer never existed" (404 no_event_buffer) when handling Last-Event-ID
 * resume requests.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayConfig, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";
import { makeStubAdapter } from "./fixtures/stub-adapter.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

const HERMES_GATEWAY: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: false },
		config: null,
	},
};

const RETENTION_MS = 30_000;

async function startTest(overrides?: { sseRetentionMs?: number }): Promise<{
	server: StartedServer;
	baseUrl: string;
}> {
	const adapter = makeStubAdapter({ name: "hermes" });
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "sumeru@test",
		version: "0.1.0",
		gateways: HERMES_GATEWAY,
		workspaceRoot: null,
		adapters: { hermes: adapter.adapter },
		sseHeartbeatMs: 60_000,
		sseBufferSize: null,
		sseRetentionMs: overrides?.sseRetentionMs ?? RETENTION_MS,
		ocasDir: tmpOcasDir(),
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
	};
}

async function createSession(
	baseUrl: string,
	gateway = "hermes",
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

async function postMessages(
	baseUrl: string,
	sessionId: string,
	body: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; text: string; headers: Headers }> {
	const res = await fetch(
		`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
				...headers,
			},
			body,
		},
	);
	const text = await res.text();
	return { status: res.status, text, headers: res.headers };
}

describe("@sumeru/server — SSE resume: expired vs never-existed (fix #58)", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		vi.useFakeTimers();
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		vi.useRealTimers();
		await server.stop();
	});

	it("A: resume empty-body after 30s returns 410 stream_expired", async () => {
		const sessionId = await createSession(baseUrl);

		// Send a message to create a buffer and complete it
		const sendRes = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hello" }),
		);
		expect(sendRes.status).toBe(200);

		// Advance time past retention window
		vi.advanceTimersByTime(RETENTION_MS + 1);

		// Resume with Last-Event-ID, empty body → should get 410
		const resumeRes = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "2",
		});
		expect(resumeRes.status).toBe(410);
		const body = JSON.parse(resumeRes.text) as {
			type: string;
			value: { error: string; message: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("stream_expired");
		expect(body.value.message).toMatch(/ses_/);
		expect(body.value.message).toMatch(/expired/);
		expect(body.value.message).toMatch(/30s/);
	});

	it("B: resume empty-body with no prior send returns 404 no_event_buffer", async () => {
		const sessionId = await createSession(baseUrl);

		// No message has ever been sent for this session
		const resumeRes = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "1",
		});
		expect(resumeRes.status).toBe(404);
		const body = JSON.parse(resumeRes.text) as {
			type: string;
			value: { error: string; message: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("no_event_buffer");
		expect(body.value.message).toMatch(/ses_/);
	});

	it("C: resume-with-body after 30s returns 410 stream_expired", async () => {
		const sessionId = await createSession(baseUrl);

		// Send a message to create a buffer
		const sendRes = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hello" }),
		);
		expect(sendRes.status).toBe(200);

		// Advance time past retention
		vi.advanceTimersByTime(RETENTION_MS + 1);

		// Resume with body AND Last-Event-ID → should get 410
		const resumeRes = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "Hello again" }),
			{ "last-event-id": "3" },
		);
		expect(resumeRes.status).toBe(410);
		const body = JSON.parse(resumeRes.text) as {
			type: string;
			value: { error: string; message: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("stream_expired");
		expect(body.value.message).toMatch(/expired/);
	});

	it("D: resume within 30s still works (200 with replayed events)", async () => {
		const sessionId = await createSession(baseUrl);

		// Send a message to create a buffer
		const sendRes = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hello" }),
		);
		expect(sendRes.status).toBe(200);

		// Advance time but stay within retention window
		vi.advanceTimersByTime(RETENTION_MS - 1000);

		// Resume with Last-Event-ID 0 → should replay all events
		const resumeRes = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "0",
		});
		expect(resumeRes.status).toBe(200);
		expect(resumeRes.headers.get("content-type") ?? "").toMatch(
			/^text\/event-stream/,
		);
	});

	it("E: ghost entry is pruned after 2x retentionMs, CAS replays events (Phase A3)", async () => {
		const sessionId = await createSession(baseUrl);

		// Send a message to create a buffer
		const sendRes = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hello" }),
		);
		expect(sendRes.status).toBe(200);

		// Advance past retention so buffer expires and ghost is created
		vi.advanceTimersByTime(RETENTION_MS + 1);

		// Verify ghost exists — first resume should return 410
		const firstResume = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "2",
		});
		expect(firstResume.status).toBe(410);

		// Advance well past the ghost window (another retentionMs)
		vi.advanceTimersByTime(RETENTION_MS + 1);

		// Ghost is pruned but CAS frames persist — resume now succeeds via
		// the CAS fallback path added in Phase A3 (RFC #107).
		const secondResume = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "2",
		});
		expect(secondResume.status).toBe(200);
		expect(secondResume.headers.get("content-type") ?? "").toMatch(
			/^text\/event-stream/,
		);
	});
});
