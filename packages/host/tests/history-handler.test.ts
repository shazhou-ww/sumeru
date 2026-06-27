import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createHistoryHandler } from "../src/handlers/history.js";
import type { InstanceManager } from "../src/instance-manager.js";
import type { HistoryValue, ManagedInstance } from "../src/types.js";

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
	it("returns paginated history for an instance", () => {
		const history: HistoryValue = {
			instanceId: "inst_abc",
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
					hash: null,
				},
			],
		};
		const manager = createMockManager({
			instance: minimalInstance("inst_abc"),
			history,
		});
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "inst_abc" },
			"/instances/inst_abc/history",
			"limit=1&offset=0",
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			type: "@sumeru/history",
			value: history,
		});
	});

	it("returns 404 when instance does not exist", () => {
		const manager = createMockManager({ instance: null, history: null });
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "inst_missing" },
			"/instances/inst_missing/history",
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "instance_not_found",
				message: "Instance not found",
			},
		});
	});

	it("returns 400 for invalid limit", () => {
		const manager = createMockManager({
			instance: minimalInstance("inst_abc"),
			history: null,
		});
		const handler = createHistoryHandler(manager);
		const res = createMockResponse();
		handler(
			createMockRequest(),
			res,
			{ id: "inst_abc" },
			"/instances/inst_abc/history",
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
			instance: minimalInstance("inst_abc"),
			history: null,
			getHistory: (_id, limit) => {
				requestedLimit = limit;
				return {
					instanceId: "inst_abc",
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
			{ id: "inst_abc" },
			"/instances/inst_abc/history",
			"limit=5000",
		);

		expect(res.statusCode).toBe(200);
		expect(requestedLimit).toBe(1000);
	});
});

function minimalInstance(id: string): ManagedInstance {
	return {
		id,
		prototype: "claude-code",
		status: "running",
		createdAt: "2026-06-27T00:00:00.000Z",
		projects: [],
		containerId: "container-1",
		projectName: "proj",
		composePath: "/compose.yaml",
	};
}

function createMockManager(input: {
	instance: ManagedInstance | null;
	history: HistoryValue | null;
	getHistory?: InstanceManager["getHistory"];
}): InstanceManager {
	return {
		getInstance: () => input.instance,
		getHistory:
			input.getHistory ??
			((_id, limit, offset) => {
				if (input.history === null) {
					return {
						instanceId: "inst_abc",
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
	} as InstanceManager;
}
