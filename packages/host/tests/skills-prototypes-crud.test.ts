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
			"models:",
			"  anthropic:",
			"    baseUrl: null",
			"    apiKey: sk-test",
			"  openai: null",
			"  openrouter: null",
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

	it("PUT/GET/DELETE skills and validates prototype skill references", async () => {
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

		const createPrototype = await request(
			server,
			"POST",
			"/prototypes/worker",
			JSON.stringify({
				name: "worker",
				instructions: "Worker agent",
				skills: ["demo"],
				defaults: null,
			}),
		);
		expect(createPrototype.status).toBe(201);

		const missingSkill = await request(
			server,
			"POST",
			"/prototypes/bad",
			JSON.stringify({
				name: "bad",
				instructions: "Bad",
				skills: ["missing"],
				defaults: null,
			}),
		);
		expect(missingSkill.status).toBe(400);
		expect(
			(missingSkill.body as { value: { error: string } }).value.error,
		).toBe("skills_not_found");

		const deleteBlocked = await request(server, "DELETE", "/skills/demo");
		expect(deleteBlocked.status).toBe(409);

		await request(server, "DELETE", "/prototypes/worker");
		const deleteSkill = await request(server, "DELETE", "/skills/demo");
		expect(deleteSkill.status).toBe(204);
	});
});
