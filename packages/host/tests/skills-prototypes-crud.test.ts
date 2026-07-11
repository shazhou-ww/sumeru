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
			"name: crud-host",
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
	contentType?: string,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("server not listening");
	}
	const headers: Record<string, string> = {};
	if (body !== undefined) {
		headers["Content-Type"] = contentType ?? "application/json";
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

describe("skills and prototypes CRUD routes", () => {
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

	it("PUT/GET/DELETE skills and validates prototype persona references", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-crud-"));
		writeV3HostFixture(rootDir);
		const server = await startTestServer(rootDir);

		const putSkill = await request(
			server,
			"PUT",
			"/skills/demo",
			JSON.stringify({ content: "# Demo\n" }),
		);
		expect(putSkill.status).toBe(200);
		expect(putSkill.body).toEqual({
			type: "@sumeru/skill",
			value: { name: "demo", content: "# Demo\n" },
		});

		const getSkill = await request(server, "GET", "/skills/demo");
		expect(getSkill.status).toBe(200);

		const createProvider = await request(
			server,
			"PUT",
			"/providers/test-prov",
			JSON.stringify({ apiType: "anthropic", baseUrl: null, apiKey: "sk-x" }),
		);
		expect(createProvider.status).toBe(201);

		const createModel = await request(
			server,
			"PUT",
			"/models/test-model",
			JSON.stringify({
				provider: "test-prov",
				model: "claude-sonnet-4",
				contextWindow: null,
				metadata: null,
			}),
		);
		expect(createModel.status).toBe(201);

		const createPersona = await request(
			server,
			"PUT",
			"/personas/worker-persona",
			JSON.stringify({
				instructions: "Worker agent",
			}),
		);
		expect(createPersona.status).toBe(201);

		const createPrototype = await request(
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
		);
		expect(createPrototype.status).toBe(201);

		const missingAdapter = await request(
			server,
			"PUT",
			"/prototypes/bad-adapter",
			JSON.stringify({
				name: "bad-adapter",
				persona: "worker-persona",
				model: "test-model",
				adapter: "missing-adapter",
				defaults: null,
			}),
		);
		expect(missingAdapter.status).toBe(400);
		expect(
			(missingAdapter.body as { value: { error: string } }).value.error,
		).toBe("adapter_not_found");

		const missingPersona = await request(
			server,
			"PUT",
			"/prototypes/bad",
			JSON.stringify({
				name: "bad",
				persona: "missing",
				model: "test-model",
				adapter: "sarsapa",
				defaults: null,
			}),
		);
		expect(missingPersona.status).toBe(400);
		expect(
			(missingPersona.body as { value: { error: string } }).value.error,
		).toBe("persona_not_found");

		const deleteSkill = await request(server, "DELETE", "/skills/demo");
		expect(deleteSkill.status).toBe(204);

		await request(server, "DELETE", "/prototypes/worker");
		await request(server, "DELETE", "/personas/worker-persona");
	});
});
