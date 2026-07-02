import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { VERSION } from "../src/index.js";
import { createHostHandler } from "../src/server.js";
import { createSessionManager } from "../src/session-manager.js";
import { createMockTransport } from "../src/transport.js";

function writeHostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: adapter-test",
			"maxRunning: 1",
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
		].join("\n"),
	);
}

async function request(
	server: Server,
	method: string,
	path: string,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("server not listening");
	}
	const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
		method,
	});
	const text = await response.text();
	let parsed: unknown = null;
	if (text.length > 0) {
		parsed = JSON.parse(text) as unknown;
	}
	return { status: response.status, body: parsed };
}

describe("adapters endpoints", () => {
	const servers: Array<Server> = [];

	afterEach(async () => {
		for (const server of servers) {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		}
		servers.length = 0;
	});

	async function startTestServer(rootDir: string): Promise<Server> {
		const hostConfig = await loadHostConfig(rootDir);
		const manager = createSessionManager({
			hostConfig,
			transport: createMockTransport().transport,
		});
		const handler = createHostHandler({
			hostConfig,
			manager,
			version: VERSION,
		});
		const server = createServer(handler);
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		servers.push(server);
		return server;
	}

	it("GET /adapters returns adapter list", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-adapters-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const list = await request(server, "GET", "/adapters");
		expect(list.status).toBe(200);
		expect(list.body).toMatchObject({
			type: "@sumeru/adapter-list",
		});
		const body = list.body as { value: Array<{ name: string }> };
		const names = body.value.map((item) => item.name);
		expect(names).toContain("cursor-agent");
		expect(names).toContain("claude-code");
		expect(names).toContain("sarsapa");
	});

	it("GET /adapters/:name returns one adapter", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-adapters-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const detail = await request(server, "GET", "/adapters/cursor-agent");
		expect(detail.status).toBe(200);
		expect(detail.body).toMatchObject({
			type: "@sumeru/adapter",
			value: {
				name: "cursor-agent",
			},
		});
	});

	it("GET /adapters/:name returns 404 for unknown adapter", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-adapters-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const detail = await request(server, "GET", "/adapters/nonexistent");
		expect(detail.status).toBe(404);
		expect(detail.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "adapter_not_found",
				message: "Adapter nonexistent not found",
			},
		});
	});
});
