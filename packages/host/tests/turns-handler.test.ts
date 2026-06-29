import type { IncomingMessage, ServerResponse } from "node:http";
import type { Turn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createTurnsHandler } from "../src/handlers/turns.js";
import type { SessionManager } from "../src/session-manager.js";
import type { ManagedSession } from "../src/types.js";

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

const sampleTurns: Array<Turn> = [
	{
		id: 0,
		role: "assistant",
		content: "hello",
		toolCalls: [],
		tokenUsage: { input: 1, output: 2, cached: 0 },
		durationMs: 10,
		timestamp: "2026-06-29T00:00:00.000Z",
	},
	{
		id: 1,
		role: "tool",
		callId: "call_0",
		name: "read",
		result: "ok",
		durationMs: 5,
		timestamp: "2026-06-29T00:00:01.000Z",
	},
];

describe("createTurnsHandler", () => {
	it("returns all turns for a session", () => {
		const manager = createMockManager({
			session: minimalSession("ses_abc"),
			turns: sampleTurns,
		});
		const handler = createTurnsHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_abc" },
			"/sessions/ses_abc/turns",
			"",
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			type: "@sumeru/turn-list",
			value: sampleTurns,
		});
	});

	it("filters turns with ?after=<id>", () => {
		const manager = createMockManager({
			session: minimalSession("ses_abc"),
			turns: sampleTurns,
		});
		const handler = createTurnsHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_abc" },
			"/sessions/ses_abc/turns",
			"after=0",
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			type: "@sumeru/turn-list",
			value: [sampleTurns[1]],
		});
	});

	it("returns 404 when session does not exist", () => {
		const manager = createMockManager({ session: null, turns: [] });
		const handler = createTurnsHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_missing" },
			"/sessions/ses_missing/turns",
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

	it("returns 400 for invalid after", () => {
		const manager = createMockManager({
			session: minimalSession("ses_abc"),
			turns: sampleTurns,
		});
		const handler = createTurnsHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "ses_abc" },
			"/sessions/ses_abc/turns",
			"after=abc",
		);

		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "invalid_request",
				message:
					"Query parameter 'after' must be a non-negative integer (got 'abc')",
			},
		});
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
	turns: Array<Turn>;
}): SessionManager {
	return {
		getSession: () => input.session,
		getSessionTurns: (_id, after) => {
			if (after === null) return input.turns;
			return input.turns.filter((turn) => turn.id > after);
		},
	} as SessionManager;
}
