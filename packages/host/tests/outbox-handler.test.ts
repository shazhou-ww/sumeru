import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createOutboxHandler } from "../src/handlers/outbox.js";
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

describe("createOutboxHandler", () => {
	it("replays buffered events after Last-Event-ID before subscribing", () => {
		const buffer = createSseBuffer();
		buffer.append({
			event: "turn",
			data: JSON.stringify({ type: "turn", value: { index: 0 } }),
		});
		buffer.append({
			event: "done",
			data: JSON.stringify({ type: "done", value: { summary: "ok" } }),
		});

		const manager = createMockManager(buffer);
		const handler = createOutboxHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest("1"), res, { id: "inst_1" });

		const body = res.chunks.join("");
		expect(body).toContain("id: 2");
		expect(body).toContain("event: done");
		expect(res.writableEnded).toBe(true);
	});

	it("returns 410 when Last-Event-ID is beyond the replay buffer", () => {
		const buffer = createSseBuffer(2);
		buffer.append({ event: "turn", data: "1" });
		buffer.append({ event: "turn", data: "2" });
		buffer.append({ event: "turn", data: "3" });

		const manager = createMockManager(buffer);
		const handler = createOutboxHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest("1"), res, { id: "inst_1" });

		expect(res.statusCode).toBe(410);
		expect(res.chunks.join("")).toContain("sse_buffer_expired");
	});

	it("streams live events with ids after replay", () => {
		const buffer = createSseBuffer();
		let subscriber: ((event: SseEvent) => void) | null = null;
		const manager: SessionManager = {
			getSseBuffer: () => buffer,
			subscribeOutbox: (_id, onEvent) => {
				subscriber = onEvent;
				return () => {
					subscriber = null;
				};
			},
		} as SessionManager;

		const handler = createOutboxHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(null), res, { id: "inst_1" });

		subscriber?.({
			id: 1,
			event: "turn",
			data: JSON.stringify({ type: "turn" }),
		});

		const body = res.chunks.join("");
		expect(body).toContain("id: 1");
		expect(body).toContain("event: turn");
	});

	it("sends heartbeat events on an interval", () => {
		vi.useFakeTimers();
		const buffer = createSseBuffer();
		const manager = createMockManager(buffer);
		const handler = createOutboxHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(null), res, { id: "inst_1" });

		vi.advanceTimersByTime(15_000);
		const body = res.chunks.join("");
		expect(body).toContain("event: heartbeat");
		expect(body).toContain("data: {}");
		vi.useRealTimers();
	});
});

function createMockManager(buffer: ReturnType<typeof createSseBuffer>) {
	return {
		getSseBuffer: () => buffer,
		subscribeOutbox: () => () => undefined,
	} as SessionManager;
}
