import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createEventLog } from "../src/event-log.js";
import { createEventsHandler } from "../src/handlers/events.js";
import type { SessionManager } from "../src/session-manager.js";
import { createSseBuffer, type SseEvent } from "../src/sse-buffer.js";

function createMockResponse(): ServerResponse & {
	chunks: Array<string>;
	statusCode: number;
	headers: Record<string, string | Array<string>>;
	writableEnded: boolean;
} {
	const socket = new Socket();
	const res = new EventEmitter() as ServerResponse & {
		chunks: Array<string>;
		statusCode: number;
		headers: Record<string, string | Array<string>>;
		writableEnded: boolean;
	};
	res.socket = socket;
	res.chunks = [];
	res.statusCode = 200;
	res.headers = {};
	res.writableEnded = false;
	res.setHeader = (name: string, value: string | Array<string>) => {
		res.headers[name.toLowerCase()] = value;
		return res;
	};
	res.write = (chunk: string | Buffer) => {
		res.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
		return true;
	};
	res.end = (payload?: string | Buffer | (() => void)) => {
		if (typeof payload === "string" || Buffer.isBuffer(payload)) {
			res.chunks.push(
				typeof payload === "string" ? payload : payload.toString("utf8"),
			);
		}
		res.writableEnded = true;
		return res;
	};
	res.flushHeaders = () => undefined;
	return res;
}

function createMockRequest(lastEventId: string | null): IncomingMessage {
	const req = new EventEmitter() as IncomingMessage;
	req.headers = lastEventId === null ? {} : { "last-event-id": lastEventId };
	return req;
}

describe("createEventsHandler", () => {
	it("replays buffered events after Last-Event-ID before subscribing", () => {
		const buffer = createSseBuffer();
		buffer.append({
			event: "turn",
			data: JSON.stringify({
				id: 0,
				role: "assistant",
				content: "hello",
				toolCalls: [],
				tokenUsage: { input: 0, output: 0, cached: 0 },
				durationMs: 0,
				timestamp: "2026-06-29T00:00:00.000Z",
			}),
		});
		buffer.append({
			event: "exit",
			data: JSON.stringify({
				type: "complete",
				message: "ok",
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 0, output: 0, cached: 0 },
			}),
		});

		const manager = createMockManager(buffer);
		const handler = createEventsHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest("1"), res, { id: "ses_1" });

		const body = res.chunks.join("");
		expect(body).toContain("id: 2");
		expect(body).toContain("event: exit");
		expect(res.writableEnded).toBe(true);
	});

	it("returns 410 when Last-Event-ID is beyond the replay buffer", () => {
		const buffer = createSseBuffer(2);
		buffer.append({ event: "turn", data: "1" });
		buffer.append({ event: "turn", data: "2" });
		buffer.append({ event: "turn", data: "3" });

		const manager = createMockManager(buffer);
		const handler = createEventsHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest("1"), res, { id: "ses_1" });

		expect(res.statusCode).toBe(410);
		expect(res.chunks.join("")).toContain("sse_buffer_expired");
	});

	it("streams live events with ids after replay", () => {
		const buffer = createSseBuffer();
		let subscriber: ((event: SseEvent) => void) | null = null;
		const manager: SessionManager = {
			getSseBuffer: () => buffer,
			getEventLog: () => createEventLog("/tmp/sumeru-test-logs", "ses_1"),
			getSession: () => ({ status: "running" }),
			subscribeEvents: (_id, onEvent) => {
				subscriber = onEvent;
				return () => {
					subscriber = null;
				};
			},
		} as SessionManager;

		const handler = createEventsHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(null), res, { id: "ses_1" });

		subscriber?.({
			id: 1,
			event: "turn",
			data: JSON.stringify({ id: 0, role: "assistant", content: "hi" }),
		});

		const body = res.chunks.join("");
		expect(body).toContain("id: 1");
		expect(body).toContain("event: turn");
	});

	it("sends heartbeat comment lines on an interval", () => {
		vi.useFakeTimers();
		const buffer = createSseBuffer();
		const manager = createMockManager(buffer);
		const handler = createEventsHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(null), res, { id: "ses_1" });

		vi.advanceTimersByTime(15_000);
		const body = res.chunks.join("");
		expect(body).toContain(": heartbeat");
		vi.useRealTimers();
	});
});

function createMockManager(buffer: ReturnType<typeof createSseBuffer>) {
	const eventLog = createEventLog("/tmp/sumeru-test-logs", "ses_mock");
	return {
		getSseBuffer: () => buffer,
		getEventLog: () => eventLog,
		getSession: () => ({ status: "running" }),
		subscribeEvents: () => () => undefined,
	} as SessionManager;
}
