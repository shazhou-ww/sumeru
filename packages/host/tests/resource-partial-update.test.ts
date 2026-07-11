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

function writeV3HostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: partial-update-host",
			"maxRunning: 3",
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
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	return { status: response.status, body: parsed };
}

function envelopeValue(body: unknown): Record<string, unknown> {
	return (body as { value: Record<string, unknown> }).value;
}

describe("resource partial update routes", () => {
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

	it("supports partial PUT updates for provider, model, persona, and prototype", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-partial-"));
		writeV3HostFixture(rootDir);
		const server = await startTestServer(rootDir);

		await request(
			server,
			"PUT",
			"/skills/demo",
			JSON.stringify({ content: "# Demo\n" }),
		);

		expect(
			(
				await request(
					server,
					"PUT",
					"/providers/test-prov",
					JSON.stringify({
						apiType: "anthropic",
						baseUrl: "http://localhost:8080",
						apiKey: "sk-original",
					}),
				)
			).status,
		).toBe(201);

		const partialProvider = await request(
			server,
			"PUT",
			"/providers/test-prov",
			JSON.stringify({ baseUrl: "http://localhost:9090" }),
		);
		expect(partialProvider.status).toBe(200);
		expect(envelopeValue(partialProvider.body)).toMatchObject({
			name: "test-prov",
			apiType: "anthropic",
			baseUrl: "http://localhost:9090",
		});

		expect(
			(
				await request(
					server,
					"PUT",
					"/models/test-model",
					JSON.stringify({
						provider: "test-prov",
						model: "claude-sonnet-4",
						contextWindow: 128000,
						metadata: { tier: "fast" },
					}),
				)
			).status,
		).toBe(201);

		const partialModel = await request(
			server,
			"PUT",
			"/models/test-model",
			JSON.stringify({ model: "claude-opus-4" }),
		);
		expect(partialModel.status).toBe(200);
		expect(envelopeValue(partialModel.body)).toMatchObject({
			name: "test-model",
			provider: "test-prov",
			model: "claude-opus-4",
			contextWindow: 128000,
			metadata: { tier: "fast" },
		});

		expect(
			(
				await request(
					server,
					"PUT",
					"/personas/worker-persona",
					JSON.stringify({
						instructions: "Original instructions",
					}),
				)
			).status,
		).toBe(201);

		const partialPersona = await request(
			server,
			"PUT",
			"/personas/worker-persona",
			JSON.stringify({ instructions: "Updated instructions" }),
		);
		expect(partialPersona.status).toBe(200);
		expect(envelopeValue(partialPersona.body)).toMatchObject({
			name: "worker-persona",
			instructions: "Updated instructions",
		});

		expect(
			(
				await request(
					server,
					"PUT",
					"/prototypes/worker",
					JSON.stringify({
						name: "worker",
						persona: "worker-persona",
						model: "test-model",
						adapter: "sarsapa",
						defaults: null,
					}),
				)
			).status,
		).toBe(201);

		const partialPrototype = await request(
			server,
			"PUT",
			"/prototypes/worker",
			JSON.stringify({ adapter: "claude-code" }),
		);
		expect(partialPrototype.status).toBe(200);
		expect(envelopeValue(partialPrototype.body)).toMatchObject({
			name: "worker",
			persona: "worker-persona",
			model: "test-model",
			adapter: "claude-code",
			defaults: null,
		});
	});
});
