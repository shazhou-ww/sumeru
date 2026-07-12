import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createWatchHandler } from "../src/handlers/watch.js";
import type { SessionManager } from "../src/session-manager.js";
import type { SseEvent } from "../src/sse-buffer.js";
import type { ManagedSession } from "../src/types.js";

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

function createMockRequest(): IncomingMessage {
	return new EventEmitter() as IncomingMessage;
}

function minimalSession(id: string): ManagedSession {
	return {
		id,
		prototype: "claude-code",
		model: {
			provider: "anthropic",
			name: "claude-sonnet-4",
			apiKey: "sk-test",
		},
		image: "example",
		project: "demo",
		task: "hello",
		status: "running",
		exit: null,
		createdAt: "2026-06-27T00:00:00.000Z",
		containerId: "container-1",
		projectName: "proj",
		composePath: "/compose.yaml",
		imageTag: null,
		initVersion: null,
		projectPath: "/tmp/workspaces/demo",
		sessionEnv: {},
	};
}

describe("createWatchHandler", () => {
	it("returns 404 when session does not exist", () => {
		const manager = {
			getSession: () => null,
		} as SessionManager;
		const handler = createWatchHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(), res, { id: "ses_missing" });

		expect(res.statusCode).toBe(404);
		expect(res.chunks.join("")).toContain("session_not_found");
	});

	it("sends connected event immediately on connect", () => {
		const manager = {
			getSession: () => minimalSession("ses_1"),
			subscribeEvents: () => () => undefined,
		} as SessionManager;
		const handler = createWatchHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(), res, { id: "ses_1" });

		const body = res.chunks.join("");
		expect(body).toContain("event: connected");
		expect(body).toContain('"ts":');
		expect(res.writableEnded).toBe(false);
	});

	it("streams turn and exit events from subscription", () => {
		let subscriber: ((event: SseEvent) => void) | null = null;
		const manager = {
			getSession: () => minimalSession("ses_1"),
			subscribeEvents: (_id, onEvent) => {
				subscriber = onEvent;
				return () => {
					subscriber = null;
				};
			},
		} as SessionManager;

		const handler = createWatchHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(), res, { id: "ses_1" });

		subscriber?.({
			id: 1,
			event: "turn",
			data: JSON.stringify({ id: 0, role: "assistant", content: "hi" }),
		});
		subscriber?.({
			id: 2,
			event: "exit",
			data: JSON.stringify({ type: "complete", message: "ok" }),
		});

		const body = res.chunks.join("");
		expect(body).toContain("event: turn");
		expect(body).toContain("event: exit");
		expect(res.writableEnded).toBe(false);
	});

	it("does not close the stream after exit events", () => {
		let subscriber: ((event: SseEvent) => void) | null = null;
		const manager = {
			getSession: () => minimalSession("ses_1"),
			subscribeEvents: (_id, onEvent) => {
				subscriber = onEvent;
				return () => undefined;
			},
		} as SessionManager;

		const handler = createWatchHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(), res, { id: "ses_1" });

		subscriber?.({
			id: 1,
			event: "exit",
			data: JSON.stringify({ type: "complete", message: "done" }),
		});

		expect(res.writableEnded).toBe(false);
	});

	it("sends heartbeat comment lines on an interval", () => {
		vi.useFakeTimers();
		const manager = {
			getSession: () => minimalSession("ses_1"),
			subscribeEvents: () => () => undefined,
		} as SessionManager;
		const handler = createWatchHandler(manager);
		const res = createMockResponse();
		handler(createMockRequest(), res, { id: "ses_1" });

		vi.advanceTimersByTime(15_000);
		const body = res.chunks.join("");
		expect(body).toContain(": heartbeat");
		vi.useRealTimers();
	});
});
