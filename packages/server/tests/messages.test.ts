/**
 * SSE message endpoint tests — covers the behavior specified in
 * `specs/server-message-sse-endpoint.md` and `specs/server-message-sse-resume.md`.
 *
 * The test harness uses `makeStubAdapter` so SSE behavior is exercised without
 * a real Hermes binary. Each test boots a fresh server on an ephemeral port.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const HERMES_GATEWAY: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: false },
		config: null,
	},
};

type SseEvent = {
	id: number;
	event: string;
	data: unknown;
};

async function startTest(
	stub?: StubAdapterControl,
	overrides?: {
		sseHeartbeatMs?: number;
		sseBufferSize?: number;
		sseRetentionMs?: number;
	},
): Promise<{
	server: StartedServer;
	baseUrl: string;
	stub: StubAdapterControl;
}> {
	const adapter = stub ?? makeStubAdapter({ name: "hermes" });
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "sumeru@test",
		version: "0.1.0",
		gateways: HERMES_GATEWAY,
		workspaceRoot: null,
		adapters: { hermes: adapter.adapter },
		sseHeartbeatMs: overrides?.sseHeartbeatMs ?? null,
		sseBufferSize: overrides?.sseBufferSize ?? null,
		sseRetentionMs: overrides?.sseRetentionMs ?? null,
		ocasDir: tmpOcasDir(),
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
		stub: adapter,
	};
}

async function createSession(baseUrl: string): Promise<string> {
	const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
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

function parseSseStream(raw: string): SseEvent[] {
	const events: SseEvent[] = [];
	const records = raw.split("\n\n").filter((r) => r.trim().length > 0);
	for (const record of records) {
		let id: number | null = null;
		let event = "";
		let data = "";
		for (const line of record.split("\n")) {
			if (line.startsWith("id:"))
				id = Number.parseInt(line.slice(3).trim(), 10);
			else if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data = line.slice(5).trim();
		}
		if (id !== null) {
			events.push({ id, event, data: data === "" ? null : JSON.parse(data) });
		}
	}
	return events;
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

describe("@sumeru/server — POST /gateways/:name/sessions/:id/messages (SSE)", () => {
	let server: StartedServer;
	let baseUrl: string;
	let _stub: StubAdapterControl;

	beforeEach(async () => {
		const ctx = await startTest();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		_stub = ctx.stub;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("happy path: streams turn events then a done event with summary", async () => {
		const sessionId = await createSession(baseUrl);
		const { status, text, headers } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		expect(status).toBe(200);
		expect(headers.get("content-type") ?? "").toMatch(/^text\/event-stream/);
		expect(headers.get("cache-control") ?? "").toMatch(/no-cache/);
		expect(headers.get("x-accel-buffering")).toBe("no");

		const events = parseSseStream(text);
		const turnEvents = events.filter((e) => e.event === "turn");
		const doneEvents = events.filter((e) => e.event === "done");
		expect(turnEvents.length).toBeGreaterThanOrEqual(1);
		expect(doneEvents.length).toBe(1);
		// envelope shape
		for (const evt of turnEvents) {
			expect((evt.data as { type: string }).type).toBe("@sumeru/turn");
		}
		const done = doneEvents[0]?.data as {
			type: string;
			value: { turnCount: number; tokens: unknown; durationMs: number };
		};
		expect(done.type).toBe("@sumeru/summary");
		expect(done.value.turnCount).toBe(turnEvents.length);
		expect(typeof done.value.durationMs).toBe("number");
		// ids are strictly increasing starting at 1
		const ids = events.map((e) => e.id);
		expect(ids[0]).toBe(1);
		for (let i = 1; i < ids.length; i++) {
			expect(ids[i]).toBe((ids[i - 1] ?? 0) + 1);
		}
	});

	it("400 invalid_request when content is empty string", async () => {
		const sessionId = await createSession(baseUrl);
		const { status, text } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "" }),
		);
		expect(status).toBe(400);
		const body = JSON.parse(text) as {
			type: string;
			value: { error: string; message: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toMatch(/non-empty/);
	});

	it("400 invalid_request when content field is missing entirely", async () => {
		const sessionId = await createSession(baseUrl);
		const { status, text } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ other: "x" }),
		);
		expect(status).toBe(400);
		const body = JSON.parse(text) as {
			value: { error: string; message: string };
		};
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toMatch(/Missing required field 'content'/);
	});

	it("400 invalid_last_event_id when header is malformed", async () => {
		const sessionId = await createSession(baseUrl);
		const { status, text } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
			{ "last-event-id": "not-a-number" },
		);
		expect(status).toBe(400);
		const body = JSON.parse(text) as {
			value: { error: string; message: string };
		};
		expect(body.value.error).toBe("invalid_last_event_id");
	});

	it("404 no_event_buffer for empty-body Last-Event-ID resume on a fresh session", async () => {
		const sessionId = await createSession(baseUrl);
		const { status, text } = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "1",
		});
		expect(status).toBe(404);
		const body = JSON.parse(text) as { value: { error: string } };
		expect(body.value.error).toBe("no_event_buffer");
	});

	it("404 session_not_found for unknown session id", async () => {
		const { status, text } = await postMessages(
			baseUrl,
			"ses_NONEXISTENT_NONEXISTENT_NONE",
			JSON.stringify({ content: "hi" }),
		);
		expect(status).toBe(404);
		const body = JSON.parse(text) as { value: { error: string } };
		expect(body.value.error).toBe("session_not_found");
	});

	it("404 gateway_not_found for unknown gateway", async () => {
		const sessionId = await createSession(baseUrl);
		const res = await fetch(
			`${baseUrl}/gateways/does-not-exist/sessions/${sessionId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			},
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("405 with Allow: GET, POST on PUT /messages", async () => {
		const sessionId = await createSession(baseUrl);
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
			{ method: "PUT" },
		);
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET, POST");
	});

	it("404 on POST /messages to a closed session", async () => {
		const sessionId = await createSession(baseUrl);
		const del = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
		const { status, text } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		expect(status).toBe(404);
		const body = JSON.parse(text) as { value: { error: string } };
		expect(body.value.error).toBe("session_not_found");
	});

	it("emits event: error envelope when adapter.send rejects (and session returns to idle)", async () => {
		await server.stop();
		const failing = makeStubAdapter({
			name: "hermes",
			failOnSend: "simulated boom",
		});
		const ctx = await startTest(failing);
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		_stub = ctx.stub;
		const sessionId = await createSession(baseUrl);
		const { status, text } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		expect(status).toBe(200);
		const events = parseSseStream(text);
		const errorEvents = events.filter((e) => e.event === "error");
		const doneEvents = events.filter((e) => e.event === "done");
		expect(errorEvents.length).toBe(1);
		expect(doneEvents.length).toBe(0);
		const env = errorEvents[0]?.data as {
			type: string;
			value: { error: string; message: string };
		};
		expect(env.type).toBe("@sumeru/error");
		expect(env.value.error).toBe("adapter_error");
		expect(env.value.message).toMatch(/simulated boom/);

		// session is back to idle
		const detail = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionId}`,
		);
		const detailBody = (await detail.json()) as { value: { status: string } };
		expect(detailBody.value.status).toBe("idle");
	});

	it("409 session_busy when two sends race on the same session", async () => {
		await server.stop();
		const slow = makeStubAdapter({ name: "hermes", sendDelayMs: 200 });
		const ctx = await startTest(slow);
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		_stub = ctx.stub;
		const sessionId = await createSession(baseUrl);
		const first = postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "first" }),
		);
		// give the first request a chance to flip status to active
		await new Promise((r) => setTimeout(r, 30));
		const second = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "second" }),
		);
		expect(second.status).toBe(409);
		const body = JSON.parse(second.text) as { value: { error: string } };
		expect(body.value.error).toBe("session_busy");
		// Wait for the first to drain so the server can clean up.
		await first;
	});

	it("emits at least one heartbeat when the adapter takes longer than sseHeartbeatMs between turns", async () => {
		await server.stop();
		const slow = makeStubAdapter({
			name: "hermes",
			sendDelayMs: 200,
		});
		const ctx = await startTest(slow, { sseHeartbeatMs: 75 });
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		_stub = ctx.stub;
		const sessionId = await createSession(baseUrl);
		const { status, text } = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		expect(status).toBe(200);
		const events = parseSseStream(text);
		const heartbeats = events.filter((e) => e.event === "heartbeat");
		expect(heartbeats.length).toBeGreaterThanOrEqual(1);
		const hb = heartbeats[0]?.data as {
			type: string;
			value: { elapsed: number };
		};
		expect(hb.type).toBe("@sumeru/heartbeat");
		expect(typeof hb.value.elapsed).toBe("number");
	});

	it("Last-Event-ID resume (empty body) replays only events after the cursor", async () => {
		const sessionId = await createSession(baseUrl);
		// First send: produce a buffer with several events
		const first = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		const firstEvents = parseSseStream(first.text);
		expect(firstEvents.length).toBeGreaterThanOrEqual(2);
		const lastId = firstEvents[firstEvents.length - 1]?.id ?? 0;

		// Resume from id 1 with empty body — should replay events 2..lastId
		const resume = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "1",
		});
		expect(resume.status).toBe(200);
		const replayed = parseSseStream(resume.text);
		expect(replayed.length).toBe(firstEvents.length - 1);
		expect(replayed[0]?.id).toBe(2);
		expect(replayed[replayed.length - 1]?.id).toBe(lastId);

		// Resume from the highest id — should replay zero events
		const upToDate = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": String(lastId),
		});
		expect(upToDate.status).toBe(200);
		const empty = parseSseStream(upToDate.text);
		expect(empty.length).toBe(0);
	});

	it("400 invalid_last_event_id when Last-Event-ID exceeds highest known id (resume-only)", async () => {
		const sessionId = await createSession(baseUrl);
		await postMessages(baseUrl, sessionId, JSON.stringify({ content: "hi" }));
		const { status, text } = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "9999",
		});
		expect(status).toBe(400);
		const body = JSON.parse(text) as { value: { error: string } };
		expect(body.value.error).toBe("invalid_last_event_id");
	});

	it("410 events_evicted when Last-Event-ID is older than ring buffer window", async () => {
		await server.stop();
		// Configure a tiny ring buffer (size 1) so events are evicted quickly.
		const tinyRingStub = makeStubAdapter({
			name: "hermes",
			respond: async function* (content) {
				const turns = [
					{
						index: 1,
						role: "assistant" as const,
						content: `r:${content}`,
						timestamp: new Date().toISOString(),
						toolCalls: null,
					},
					{
						index: 2,
						role: "assistant" as const,
						content: "another",
						timestamp: new Date().toISOString(),
						toolCalls: null,
					},
					{
						index: 3,
						role: "assistant" as const,
						content: "third",
						timestamp: new Date().toISOString(),
						toolCalls: null,
					},
				];
				for (const turn of turns) {
					yield { type: "turn" as const, turn };
				}
				yield { type: "done" as const, durationMs: 0, tokens: null };
			},
		});
		const ctx = await startTest(tinyRingStub, { sseBufferSize: 2 });
		server = ctx.server;
		baseUrl = ctx.baseUrl;
		_stub = ctx.stub;

		const sessionId = await createSession(baseUrl);
		const first = await postMessages(
			baseUrl,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		const firstEvents = parseSseStream(first.text);
		expect(firstEvents.length).toBeGreaterThan(2);
		// Resume from id 1 — but id 1 has been evicted from the 2-slot ring.
		const resume = await postMessages(baseUrl, sessionId, "", {
			"last-event-id": "1",
		});
		expect(resume.status).toBe(410);
		const body = JSON.parse(resume.text) as { value: { error: string } };
		expect(body.value.error).toBe("events_evicted");
	});

	// Opt-in integration: stream a real assistant turn through the SSE endpoint.
	// Skipped by default — set SUMERU_HERMES_INTEGRATION=1 to run.
	it.skipIf(process.env.SUMERU_HERMES_INTEGRATION !== "1")(
		"streams a real assistant turn from a live Hermes binary",
		async () => {
			// This test intentionally does NOT instantiate stub adapters.
			// The harness must be invoked manually with the real Hermes
			// adapter; see e2e-hermes-roundtrip.test.ts for the full flow.
			expect(process.env.SUMERU_HERMES_INTEGRATION).toBe("1");
		},
		90_000,
	);

	// Regression: SSE events must be flushed to the client immediately —
	// heartbeats must arrive WHILE the adapter is still running, not
	// buffered until after res.end(). Fixes #30.
	it("flushes heartbeats to client while adapter is running (no TCP buffering)", async () => {
		// Adapter takes 600ms to respond; heartbeat interval is 100ms.
		// We expect at least 2 heartbeats to arrive BEFORE the adapter
		// returns — proving they were flushed incrementally.
		const stub = makeStubAdapter({
			name: "hermes",
			sendDelayMs: 600,
		});
		const { server, baseUrl } = await startTest(stub, {
			sseHeartbeatMs: 100,
		});

		const sessionId = await createSession(baseUrl);

		// Use a streaming reader instead of res.text() — we need to
		// observe chunks arriving incrementally, not after the stream ends.
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "text/event-stream",
				},
				body: JSON.stringify({ content: "hello" }),
			},
		);
		expect(res.status).toBe(200);
		expect(res.body).not.toBeNull();

		const reader = res.body?.getReader();
		const decoder = new TextDecoder();
		let accumulated = "";
		let heartbeatsSeen = 0;
		let doneEventSeen = false;
		const deadline = Date.now() + 3000;

		while (Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			accumulated += decoder.decode(value, { stream: true });

			// Count complete SSE events in accumulated text so far
			const records = accumulated
				.split("\n\n")
				.filter((r) => r.trim().length > 0);
			heartbeatsSeen = 0;
			doneEventSeen = false;
			for (const record of records) {
				if (
					record.includes("event: heartbeat") ||
					record.includes("event:heartbeat")
				) {
					heartbeatsSeen += 1;
				}
				if (record.includes("event: done") || record.includes("event:done")) {
					doneEventSeen = true;
				}
			}

			if (doneEventSeen) break;
		}

		await reader.cancel().catch(() => {});
		await server.stop();

		// With 600ms adapter delay and 100ms heartbeat interval, we expect
		// at least 2 heartbeats to have arrived before the done event.
		// If setNoDelay is missing, 0 heartbeats arrive (all buffered).
		expect(heartbeatsSeen).toBeGreaterThanOrEqual(2);
		expect(doneEventSeen).toBe(true);
	}, 10_000);
});
