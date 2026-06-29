import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createRootHandler } from "../src/handlers/root.js";
import type { SessionManager } from "../src/session-manager.js";

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

describe("createRootHandler", () => {
	it("returns host status envelope", () => {
		const manager = {
			hostRoot: () => ({
				name: "test-host",
				status: { running: 1, queued: 2, idle: 3 },
				uptime: 42,
			}),
		} as SessionManager;
		const handler = createRootHandler({ manager, version: "0.1.0" });
		const res = createMockResponse();
		handler({} as IncomingMessage, res);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			type: "@sumeru/host",
			value: {
				name: "test-host",
				version: "0.1.0",
				status: { running: 1, queued: 2, idle: 3 },
				uptime: 42,
			},
		});
	});
});
