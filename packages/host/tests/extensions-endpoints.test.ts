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
			"name: extension-test",
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
	body?: string,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("server not listening");
	}
	const headers: Record<string, string> = {};
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
		headers["Content-Length"] = Buffer.byteLength(body).toString();
	}
	const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
		method,
		headers,
		body,
	});
	const text = await response.text();
	let parsed: unknown = null;
	if (text.length > 0) {
		parsed = JSON.parse(text) as unknown;
	}
	return { status: response.status, body: parsed };
}

describe("extensions endpoints", () => {
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

	it("GET /extensions returns extension list", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-extensions-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const list = await request(server, "GET", "/extensions");
		expect(list.status).toBe(200);
		expect(list.body).toMatchObject({
			type: "@sumeru/extension-list",
			value: [],
		});
	});

	it("PUT /extensions/rust creates and updates extension", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-extensions-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const create = await request(
			server,
			"PUT",
			"/extensions/rust",
			JSON.stringify({
				description: "Rust toolchain",
				dockerfile: "RUN apt-get update && apt-get install -y rustc",
			}),
		);
		expect(create.status).toBe(201);
		expect(create.body).toMatchObject({
			type: "@sumeru/extension",
			value: {
				name: "rust",
				description: "Rust toolchain",
				dockerfile: "RUN apt-get update && apt-get install -y rustc",
			},
		});

		const replace = await request(
			server,
			"PUT",
			"/extensions/rust",
			JSON.stringify({
				description: "Rust toolchain v2",
				dockerfile: "RUN curl --proto '=https' -sSf https://sh.rustup.rs | sh",
			}),
		);
		expect(replace.status).toBe(200);
		expect(
			(replace.body as { value: { description: string } }).value.description,
		).toBe("Rust toolchain v2");
	});

	it("GET /extensions/rust returns the extension", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-extensions-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await request(
			server,
			"PUT",
			"/extensions/rust",
			JSON.stringify({
				description: "Rust",
				dockerfile: "RUN apt-get install -y rustc",
			}),
		);

		const detail = await request(server, "GET", "/extensions/rust");
		expect(detail.status).toBe(200);
		expect(detail.body).toMatchObject({
			type: "@sumeru/extension",
			value: { name: "rust", description: "Rust" },
		});
	});

	it("PUT /extensions/rust without dockerfile returns 400 on create", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-extensions-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const result = await request(
			server,
			"PUT",
			"/extensions/rust",
			JSON.stringify({ description: "Rust" }),
		);
		expect(result.status).toBe(400);
		expect(result.body).toMatchObject({
			type: "@sumeru/error",
			value: { error: "invalid_body" },
		});
	});

	it("DELETE /extensions/rust returns 204", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-extensions-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await request(
			server,
			"PUT",
			"/extensions/rust",
			JSON.stringify({
				description: "Rust",
				dockerfile: "RUN apt-get install -y rustc",
			}),
		);

		const del = await request(server, "DELETE", "/extensions/rust");
		expect(del.status).toBe(204);
		expect(del.body).toBeNull();
	});

	it("GET /extensions/nonexistent returns 404", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-extensions-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const detail = await request(server, "GET", "/extensions/nonexistent");
		expect(detail.status).toBe(404);
		expect(detail.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "extension_not_found",
				message: "Extension nonexistent not found",
			},
		});
	});
});
