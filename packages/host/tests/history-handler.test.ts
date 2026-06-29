import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createHistoryHandler } from "../src/handlers/history.js";
import type { SessionManager } from "../src/session-manager.js";
import type { HistoryValue, ManagedSession } from "../src/types.js";

function createMockResponse(): ServerResponse & {
	body: unknown;
	statusCode: number;
} {
	const res = {
		statusCode: 200,
		body: null as unknown,
		headers: {} as Record<string, string>,
		setHeader(name: string, value: string) {
			res.headers[name.toLowerCase()] = value;
			return res;
		},
		end(payload?: string) {
			if (payload !== undefined) {
				res.body = JSON.parse(payload);
			}
		},
	} as ServerResponse & { body: unknown; statusCode: number };
	return res;
}

function createMockRequest(): IncomingMessage {
	return {} as IncomingMessage;
}

describe("createHistoryHandler", () => {
	it("returns paginated history for a session", () => {
		const history: HistoryValue = {
			sessionId: "ses_abc",
			total: 2,
			offset: 0,
			turns: [
				{
					timestamp: "2026-06-27T00:00:00.000Z",
					type: "turn",
					value: {
						index: 0,
						role: "user",
						content: "hello",
						timestamp: "2026-06-27T00:00:00.000Z",
						toolCalls: null,
						tokens: null,
					},
					hash: "ABCDEFGH12345",
				},
			],
		};
		const manager = createMockManager({
			session: minimalSession("ses_abc"),
			history,
		});
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_abc" },
			"/sessions/ses_abc/history",
			"limit=1&offset=0",
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			type: "@sumeru/history",
			value: history,
		});
	});

	it("returns 404 when session does not exist", () => {
		const manager = createMockManager({ session: null, history: null });
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_missing" },
			"/sessions/ses_missing/history",
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "session_not_found",
				message: "Session not found",
			},
		});
	});

	it("returns 400 for invalid limit", () => {
		const manager = createMockManager({
			session: minimalSession("ses_abc"),
			history: null,
		});
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_abc" },
			"/sessions/ses_abc/history",
			"limit=abc",
		);

		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "invalid_request",
				message:
					"Query parameter 'limit' must be a non-negative integer (got 'abc')",
			},
		});
	});

	it("caps limit at 1000", () => {
		let requestedLimit = 0;
		const manager = createMockManager({
			session: minimalSession("ses_abc"),
			history: null,
			getHistory: (_id, limit) => {
				requestedLimit = limit;
				return {
					sessionId: "ses_abc",
					total: 0,
					offset: 0,
					turns: [],
				};
			},
		});
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_abc" },
			"/sessions/ses_abc/history",
			"limit=5000",
		);

		expect(res.statusCode).toBe(200);
		expect(requestedLimit).toBe(1000);
	});
});

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
		initVersion: null,
		projectPath: "/tmp/workspaces/demo",
		sessionEnv: {},
	};
}

function createMockManager(input: {
	session: ManagedSession | null;
	history: HistoryValue | null;
	getHistory?: SessionManager["getHistory"];
}): SessionManager {
	return {
		getSession: () => input.session,
		getHistory:
			input.getHistory ??
			((_id, limit, offset) => {
				if (input.history === null) {
					return {
						sessionId: "ses_abc",
						total: 0,
						offset,
						turns: [],
					};
				}
				return {
					...input.history,
					offset,
					turns: input.history.turns.slice(offset, offset + limit),
				};
			}),
	} as SessionManager;
}
