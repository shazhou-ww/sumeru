import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { VERSION } from "../src/index.js";
import { createHostHandler } from "../src/server.js";
import { createSessionManager } from "../src/session-manager.js";
import { createMockTransport } from "../src/transport.js";

function writeHostFixture(rootDir: string, withEmbeddedImages: boolean): void {
	const lines = [
		"name: image-host",
		"maxRunning: 2",
		"workspaceRoot: /tmp/workspaces",
		"envFile: /dev/null",
		"models:",
		"  anthropic:",
		"    baseUrl: null",
		"    apiKey: sk-test",
		"  openai: null",
		"  openrouter: null",
	];
	if (withEmbeddedImages) {
		lines.push(
			"images:",
			"  worker:",
			'    description: "Worker image"',
			'    dockerfile: "CASWORKER001"',
			'    builtAt: "2026-06-29T00:00:00.000Z"',
			'    digest: "sha256:worker"',
		);
	}
	writeFileSync(join(rootDir, "host.yaml"), lines.join("\n"));
}

async function request(
	server: Server,
	path: string,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("server not listening");
	}
	const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
	const text = await response.text();
	return { status: response.status, body: JSON.parse(text) as unknown };
}

describe("images endpoints", () => {
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

	it("GET /images lists images from host.yaml", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-images-"));
		writeHostFixture(rootDir, true);
		const server = await startTestServer(rootDir);

		const list = await request(server, "/images");
		expect(list.status).toBe(200);
		expect(list.body).toEqual({
			type: "@sumeru/image-list",
			value: [
				{
					name: "worker",
					description: "Worker image",
					dockerfile: "CASWORKER001",
					builtAt: "2026-06-29T00:00:00.000Z",
					digest: "sha256:worker",
				},
			],
		});
	});

	it("GET /images/:name returns one image", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-images-"));
		writeHostFixture(rootDir, true);
		const server = await startTestServer(rootDir);

		const detail = await request(server, "/images/worker");
		expect(detail.status).toBe(200);
		expect(detail.body).toEqual({
			type: "@sumeru/image",
			value: {
				name: "worker",
				description: "Worker image",
				dockerfile: "CASWORKER001",
				builtAt: "2026-06-29T00:00:00.000Z",
				digest: "sha256:worker",
			},
		});
	});

	it("GET /images/:name returns 404 for unknown image", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-images-"));
		writeHostFixture(rootDir, true);
		const server = await startTestServer(rootDir);

		const detail = await request(server, "/images/missing");
		expect(detail.status).toBe(404);
		expect(detail.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "image_not_found",
				message: "Image missing not found",
			},
		});
	});

	it("loads images from images.yaml when host.yaml has no images section", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-images-"));
		writeHostFixture(rootDir, false);
		mkdirSync(join(rootDir, "data", "skills"), { recursive: true });
		mkdirSync(join(rootDir, "data", "prototypes"), { recursive: true });
		writeFileSync(
			join(rootDir, "images.yaml"),
			[
				"base:",
				'  description: ""',
				'  dockerfile: "CASBASE001"',
				'  builtAt: "2026-06-29T01:00:00.000Z"',
				'  digest: "sha256:base"',
			].join("\n"),
		);
		const server = await startTestServer(rootDir);

		const list = await request(server, "/images");
		expect(list.status).toBe(200);
		expect(list.body).toEqual({
			type: "@sumeru/image-list",
			value: [
				{
					name: "base",
					description: "",
					dockerfile: "CASBASE001",
					builtAt: "2026-06-29T01:00:00.000Z",
					digest: "sha256:base",
				},
			],
		});
	});
});
