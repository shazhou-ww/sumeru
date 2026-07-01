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

		const list = await request(server, "GET", "/images");
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

		const detail = await request(server, "GET", "/images/worker");
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

		const detail = await request(server, "GET", "/images/missing");
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

		const list = await request(server, "GET", "/images");
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

	it("POST /images/:name registers an image and DELETE removes it", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-images-"));
		writeHostFixture(rootDir, false);
		const server = await startTestServer(rootDir);

		const created = await request(
			server,
			"POST",
			"/images/hermes",
			JSON.stringify({
				name: "hermes",
				description: "Hermes worker",
				dockerfile: "docker/hermes/Dockerfile",
				builtAt: "2026-06-29T02:00:00.000Z",
				digest: "sha256:hermes",
			}),
		);
		expect(created.status).toBe(201);
		expect(created.body).toEqual({
			type: "@sumeru/image",
			value: {
				name: "hermes",
				description: "Hermes worker",
				dockerfile: "docker/hermes/Dockerfile",
				builtAt: "2026-06-29T02:00:00.000Z",
				digest: "sha256:hermes",
			},
		});

		const updated = await request(
			server,
			"POST",
			"/images/hermes",
			JSON.stringify({
				name: "hermes",
				description: "Hermes worker v2",
				dockerfile: "docker/hermes/Dockerfile",
				builtAt: "2026-06-29T03:00:00.000Z",
				digest: "sha256:hermes2",
			}),
		);
		expect(updated.status).toBe(200);

		const removed = await request(server, "DELETE", "/images/hermes");
		expect(removed.status).toBe(204);

		const missing = await request(server, "GET", "/images/hermes");
		expect(missing.status).toBe(404);
	});
});
