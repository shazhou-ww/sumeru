/**
 * Phase A3 (RFC #107) — CAS event chain persistence + withResumable middleware.
 *
 * Verifies the three core CAS-backed resume scenarios:
 *   1. restart-replay: after server restart, CAS replays all content events
 *   2. >1024 events:   CAS retains events beyond the ring buffer window
 *   3. no-expiry:      CAS frames survive past the in-memory retention period
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { GatewayConfig, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";
import {
	makeStubAdapter,
	type StubAdapterControl,
} from "./fixtures/stub-adapter.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-cas-"));
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

async function boot(
	stub: StubAdapterControl,
	ocasDir: string,
	overrides?: {
		sseBufferSize?: number;
		sseRetentionMs?: number;
		sseHeartbeatMs?: number;
	},
): Promise<{ server: StartedServer; baseUrl: string }> {
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "sumeru@test",
		version: "0.1.0",
		gateways: HERMES_GATEWAY,
		workspaceRoot: null,
		adapters: { hermes: stub.adapter },
		sseHeartbeatMs: overrides?.sseHeartbeatMs ?? 60_000,
		sseBufferSize: overrides?.sseBufferSize ?? null,
		sseRetentionMs: overrides?.sseRetentionMs ?? null,
		ocasDir,
	});
	return { server, baseUrl: `http://${server.host}:${server.port}` };
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

// ─── Scenario 1: restart-replay ──────────────────────────

describe("CAS resumable — restart-replay", () => {
	let ocasDir: string;
	let stub: StubAdapterControl;

	beforeEach(() => {
		ocasDir = tmpOcasDir();
		stub = makeStubAdapter({ name: "hermes" });
	});

	it("replays all content events from CAS after server restart", async () => {
		const { server: server1, baseUrl: url1 } = await boot(stub, ocasDir);
		const sessionId = await createSession(url1);

		const first = await postMessages(
			url1,
			sessionId,
			JSON.stringify({ content: "hello" }),
		);
		expect(first.status).toBe(200);
		const originalEvents = parseSseStream(first.text).filter(
			(e) => e.event !== "heartbeat",
		);
		expect(originalEvents.length).toBeGreaterThanOrEqual(2);

		await server1.stop();

		const { server: server2, baseUrl: url2 } = await boot(stub, ocasDir);

		const resume = await postMessages(url2, sessionId, "", {
			"last-event-id": "0",
		});

		expect(resume.status).toBe(200);
		expect(resume.headers.get("content-type") ?? "").toMatch(
			/^text\/event-stream/,
		);

		const replayed = parseSseStream(resume.text);
		expect(replayed.length).toBe(originalEvents.length);

		for (let i = 0; i < replayed.length; i++) {
			expect(replayed[i]?.event).toBe(originalEvents[i]?.event);
			expect(replayed[i]?.id).toBe(i + 1);
		}

		const turnEvents = replayed.filter((e) => e.event === "turn");
		for (const evt of turnEvents) {
			expect((evt.data as { type: string }).type).toBe("@sumeru/turn");
		}
		const doneEvents = replayed.filter((e) => e.event === "done");
		expect(doneEvents.length).toBe(1);
		expect((doneEvents[0]?.data as { type: string }).type).toBe(
			"@sumeru/summary",
		);

		await server2.stop();
	});
});

// ─── Scenario 2: >1024 events ───────────────────────────

describe("CAS resumable — >1024 events", () => {
	let ocasDir: string;

	beforeEach(() => {
		ocasDir = tmpOcasDir();
	});

	it("CAS retains all events even when the ring buffer evicts older ones", async () => {
		const EVENT_COUNT = 1025;
		const stub = makeStubAdapter({
			name: "hermes",
			respond: async function* () {
				for (let i = 1; i <= EVENT_COUNT; i++) {
					yield {
						type: "turn" as const,
						turn: {
							index: i,
							role: "assistant" as const,
							content: `turn-${i}`,
							timestamp: new Date().toISOString(),
							toolCalls: null,
						},
					};
				}
				yield { type: "done" as const, durationMs: 0, tokens: null };
			},
		});

		const { server: server1, baseUrl: url1 } = await boot(stub, ocasDir, {
			sseBufferSize: 1024,
		});
		const sessionId = await createSession(url1);

		const first = await postMessages(
			url1,
			sessionId,
			JSON.stringify({ content: "go" }),
		);
		expect(first.status).toBe(200);
		const allOriginal = parseSseStream(first.text).filter(
			(e) => e.event !== "heartbeat",
		);
		expect(allOriginal.length).toBe(EVENT_COUNT + 1);

		await server1.stop();

		const { server: server2, baseUrl: url2 } = await boot(stub, ocasDir, {
			sseBufferSize: 1024,
		});

		const resume = await postMessages(url2, sessionId, "", {
			"last-event-id": "0",
		});
		expect(resume.status).toBe(200);

		const replayed = parseSseStream(resume.text);
		expect(replayed.length).toBe(EVENT_COUNT + 1);

		expect(replayed[0]?.event).toBe("turn");
		expect(
			(replayed[0]?.data as { value: { content: string } }).value.content,
		).toBe("turn-1");

		expect(replayed[replayed.length - 1]?.event).toBe("done");

		await server2.stop();
	}, 60_000);
});

// ─── Scenario 3: no-expiry ──────────────────────────────

describe("CAS resumable — no-expiry", () => {
	let ocasDir: string;
	let stub: StubAdapterControl;

	beforeEach(() => {
		ocasDir = tmpOcasDir();
		stub = makeStubAdapter({ name: "hermes" });
	});

	it("CAS frames survive past the in-memory retention period", async () => {
		const RETENTION_MS = 100;

		const { server: server1, baseUrl: url1 } = await boot(stub, ocasDir, {
			sseRetentionMs: RETENTION_MS,
		});
		const sessionId = await createSession(url1);

		const first = await postMessages(
			url1,
			sessionId,
			JSON.stringify({ content: "hi" }),
		);
		expect(first.status).toBe(200);
		const originalEvents = parseSseStream(first.text).filter(
			(e) => e.event !== "heartbeat",
		);

		await new Promise((r) => setTimeout(r, RETENTION_MS * 3));

		await server1.stop();

		const { server: server2, baseUrl: url2 } = await boot(stub, ocasDir, {
			sseRetentionMs: RETENTION_MS,
		});

		const resume = await postMessages(url2, sessionId, "", {
			"last-event-id": "0",
		});
		expect(resume.status).toBe(200);

		const replayed = parseSseStream(resume.text);
		expect(replayed.length).toBe(originalEvents.length);

		for (let i = 0; i < replayed.length; i++) {
			expect(replayed[i]?.event).toBe(originalEvents[i]?.event);
		}

		await server2.stop();
	});
});
