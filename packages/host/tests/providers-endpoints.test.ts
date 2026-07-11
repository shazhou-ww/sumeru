import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { VERSION } from "../src/index.js";
import { createHostHandler } from "../src/server.js";
import { createSessionManager } from "../src/session-manager.js";
import { createMockTransport } from "../src/transport.js";

function writeHostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: provider-test",
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

async function putProvider(
	server: Server,
	name: string,
	body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("server not listening");
	}
	const response = await fetch(
		`http://127.0.0.1:${address.port}/providers/${encodeURIComponent(name)}`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	);
	const text = await response.text();
	let parsed: unknown = null;
	if (text.length > 0) {
		parsed = JSON.parse(text) as unknown;
	}
	return { status: response.status, body: parsed };
}

describe("providers endpoints", () => {
	const servers: Array<Server> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
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

	it("GET /providers/:name/models returns 404 for unknown provider", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-providers-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const result = await request(server, "GET", "/providers/missing/models");
		expect(result.status).toBe(404);
		expect(result.body).toMatchObject({
			type: "@sumeru/error",
			value: { error: "provider_not_found" },
		});
	});

	it("GET /providers/:name/models returns 400 when apiKey missing", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-providers-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await putProvider(server, "no-key", {
			apiType: "openai",
			baseUrl: "https://example.com/v1",
		});

		const result = await request(server, "GET", "/providers/no-key/models");
		expect(result.status).toBe(400);
		expect(result.body).toMatchObject({
			type: "@sumeru/error",
			value: { error: "credential_missing" },
		});
	});

	it("GET /providers/:name/models returns upstream models", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-providers-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await putProvider(server, "dashscope", {
			apiType: "openai",
			baseUrl: "https://example.com/v1",
			apiKey: "test-key",
		});

		const originalFetch = globalThis.fetch;
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.href
							: input.url;
				if (url.startsWith("https://example.com/")) {
					return new Response(
						JSON.stringify({
							data: [
								{
									id: "qwen-max",
									object: "model",
									owned_by: "dashscope",
								},
							],
						}),
						{ status: 200 },
					);
				}
				return originalFetch(input, init);
			});

		const result = await request(server, "GET", "/providers/dashscope/models");
		expect(result.status).toBe(200);
		expect(result.body).toEqual({
			type: "@sumeru/provider-model-list",
			value: [
				{
					id: "qwen-max",
					object: "model",
					owned_by: "dashscope",
				},
			],
		});
		expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/models", {
			headers: { Authorization: "Bearer test-key" },
		});
	});

	it("GET /providers/:name/models returns 502 when upstream fails", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-providers-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await putProvider(server, "bad-upstream", {
			apiType: "openai",
			baseUrl: "https://example.com/v1",
			apiKey: "test-key",
		});

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			if (url.startsWith("https://example.com/")) {
				return new Response("upstream error", { status: 500 });
			}
			return originalFetch(input, init);
		});

		const result = await request(
			server,
			"GET",
			"/providers/bad-upstream/models",
		);
		expect(result.status).toBe(502);
		expect(result.body).toMatchObject({
			type: "@sumeru/error",
			value: { error: "model_list_failed" },
		});
	});

	it("GET /models?provider filters registered models", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-providers-"));
		writeHostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await putProvider(server, "test-prov", {
			apiType: "openai",
			baseUrl: "https://example.com/v1",
			apiKey: "test-key",
		});

		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("server not listening");
		}
		await fetch(
			`http://127.0.0.1:${address.port}/providers/test-prov/models/my-model`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: "gpt-4" }),
			},
		);

		const result = await request(server, "GET", "/models?provider=test-prov");
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({
			type: "@sumeru/model-list",
		});
		const body = result.body as {
			value: Array<{ provider: string; name: string }>;
		};
		expect(body.value).toEqual([
			expect.objectContaining({ provider: "test-prov", name: "my-model" }),
		]);
	});
});
