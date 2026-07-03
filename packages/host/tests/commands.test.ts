import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { VERSION } from "../src/index.js";
import { createHostHandler } from "../src/server.js";
import { createSessionManager } from "../src/session-manager.js";
import type { Transport } from "../src/types.js";

const COMPOSE_PROJECT_VOLUME_MOUNT =
	"$" + "{SUMERU_PROJECT_PATH}:$" + "{SUMERU_PROJECT_PATH}";

function testComposeYaml(image: string): string {
	return [
		"services:",
		"  agent:",
		`    image: ${image}`,
		"    volumes:",
		`      - "${COMPOSE_PROJECT_VOLUME_MOUNT}"`,
	].join("\n");
}

function writeHostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: commands-test",
			"maxRunning: 2",
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
		].join("\n"),
	);
	mkdirSync("/tmp/workspaces/demo", { recursive: true });
	const dataDir = join(rootDir, "data");
	mkdirSync(join(dataDir, "skills"), { recursive: true });
	mkdirSync(join(dataDir, "prototypes"), { recursive: true });
	writeFileSync(
		join(dataDir, "prototypes", "claude-code.yaml"),
		[
			"name: claude-code",
			"persona: default-persona",
			"model: test-provider:default-model",
			"adapter: claude-code",
		].join("\n"),
	);
	writeFileSync(
		join(dataDir, "skills", "tdd.md"),
		"# TDD\n\nWrite tests first.",
	);
	const prototypeDir = join(rootDir, "prototypes", "claude-code");
	mkdirSync(prototypeDir, { recursive: true });
	writeFileSync(
		join(prototypeDir, "compose.yaml"),
		testComposeYaml("sumeru/claude-code:dev"),
	);
}

function seedDb(hostConfig: Awaited<ReturnType<typeof loadHostConfig>>): void {
	hostConfig.sqliteStore.createProvider({
		name: "test-provider",
		apiType: "anthropic",
		baseUrl: "https://example.test",
		apiKey: "sk-test-key",
	});
	hostConfig.sqliteStore.createModel({
		name: "default-model",
		provider: "test-provider",
		model: "claude-sonnet-4",
		contextWindow: null,
		toolUse: true,
		streaming: true,
		metadata: null,
	});
	hostConfig.sqliteStore.createPersona({
		name: "default-persona",
		instructions: "You are a worker.",
		skills: [],
	});
}

function createCommandsTransport(): {
	transport: Transport;
	execInputs: Array<string>;
	runOnceCommands: Array<Array<string>>;
	commitTags: Array<string>;
} {
	const execInputs: Array<string> = [];
	const runOnceCommands: Array<Array<string>> = [];
	const commitTags: Array<string> = [];
	const transport: Transport = {
		async up(input) {
			return { containerId: `container-${input.projectName}` };
		},
		async upFromImage(input) {
			return { containerId: `container-${input.containerName}` };
		},
		async down() {},
		async rm() {},
		async rmContainer() {},
		async stop() {},
		async start() {},
		exec({ containerId: _containerId, command: _command, env: _env }) {
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			stdin.on("data", (chunk: Buffer | string) => {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				execInputs.push(text);
				for (const line of text.split("\n")) {
					const trimmed = line.trim();
					if (trimmed.length === 0) continue;
					let parsed: { type?: string };
					try {
						parsed = JSON.parse(trimmed) as { type?: string };
					} catch {
						continue;
					}
					if (parsed.type === "init") {
						stdout.write(`${JSON.stringify({ type: "ready", value: {} })}\n`);
					}
					if (parsed.type === "message" || parsed.type === "chat") {
						stdout.write(
							`${JSON.stringify({
								type: "turn",
								value: {
									index: 0,
									role: "assistant",
									content: "pong",
									timestamp: "2026-06-27T00:00:00.000Z",
									toolCalls: null,
									tokens: null,
								},
							})}\n`,
						);
						stdout.write(
							`${JSON.stringify({
								type: "done",
								value: { summary: "ok", tokenUsage: null },
							})}\n`,
						);
					}
					if (
						parsed.type === "model" ||
						parsed.type === "install-skill" ||
						parsed.type === "reset"
					) {
						stdout.write(
							`${JSON.stringify({
								type: "done",
								value: { summary: "ok", tokenUsage: null },
							})}\n`,
						);
					}
				}
			});
			const rl = createInterface({ input: stdout, crlfDelay: Infinity });
			return {
				stdin,
				lines: rl,
				waitForExit: async () => ({ exitCode: 0, stderr: "" }),
			};
		},
		async runOnce({ command }) {
			runOnceCommands.push(command);
			return {
				stdout: "hello\n",
				stderr: "",
				exitCode: 0,
			};
		},
		async commit({ tag }) {
			commitTags.push(tag);
			return { imageId: "sha256:snapshot-id" };
		},
		async inspectStatus() {
			return "running";
		},
	};
	return { transport, execInputs, runOnceCommands, commitTags };
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

describe("POST /sessions/:id/commands", () => {
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

	async function startTestServer(): Promise<{
		server: Server;
		rootDir: string;
		transport: ReturnType<typeof createCommandsTransport>;
		manager: ReturnType<typeof createSessionManager>;
	}> {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-commands-"));
		writeHostFixture(rootDir);
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const transport = createCommandsTransport();
		const manager = createSessionManager({
			hostConfig,
			transport: transport.transport,
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
		return { server, rootDir, transport, manager };
	}

	it("accepts chat commands with 202", async () => {
		const { server, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({ type: "chat", content: "follow up" }),
		);
		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({
			type: "@sumeru/command-accepted",
			value: {
				sessionId: created.id,
				commandId: expect.stringMatching(/^cmd_/),
			},
		});
	});

	it("runs exec commands synchronously via docker exec", async () => {
		const { server, transport, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({ type: "exec", command: "echo hello" }),
		);
		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			type: "@sumeru/command-result",
			value: {
				type: "exec",
				stdout: "hello\n",
				stderr: "",
				exitCode: 0,
			},
		});
		expect(transport.runOnceCommands).toEqual([["sh", "-c", "echo hello"]]);
	});

	it("resolves model commands and emits model frame to sumeru-session", async () => {
		const { server, transport, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({
				type: "model",
				provider: "test-provider",
				model: "default-model",
			}),
		);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			type: "@sumeru/command-result",
			value: {
				type: "model",
				provider: "test-provider",
				model: "default-model",
			},
		});
		const modelFrame = transport.execInputs.find((line) => {
			try {
				return (JSON.parse(line.trim()) as { type?: string }).type === "model";
			} catch {
				return false;
			}
		});
		expect(modelFrame).toBeDefined();
		const parsed = JSON.parse(modelFrame?.trim() ?? "{}") as {
			value: { baseUrl: string; apiKey: string; model: string };
		};
		expect(parsed.value.baseUrl).toBe("https://example.test");
		expect(parsed.value.apiKey).toBe("sk-test-key");
		expect(parsed.value.model).toBe("claude-sonnet-4");
	});

	it("installs skills from host registry", async () => {
		const { server, transport, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({ type: "install-skill", name: "tdd" }),
		);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			type: "@sumeru/command-result",
			value: { type: "install-skill", name: "tdd" },
		});
		const frame = transport.execInputs.find((line) =>
			line.includes('"install-skill"'),
		);
		expect(frame).toContain('"name":"tdd"');
		expect(frame).toContain("Write tests first.");
	});

	it("emits reset frames", async () => {
		const { server, transport, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({ type: "reset", persona: "You are concise." }),
		);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			type: "@sumeru/command-result",
			value: { type: "reset" },
		});
		expect(
			transport.execInputs.some(
				(line) => line.includes('"reset"') && line.includes("You are concise."),
			),
		).toBe(true);
	});

	it("snapshots session into a new prototype image", async () => {
		const { server, rootDir, transport, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({ type: "snapshot", name: "my-snapshot" }),
		);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			type: "@sumeru/command-result",
			value: {
				type: "snapshot",
				name: "my-snapshot",
				image: "sumeru/my-snapshot:dev",
			},
		});
		expect(transport.commitTags).toEqual(["sumeru/my-snapshot:dev"]);
		expect(transport.execInputs.some((line) => line.includes('"reset"'))).toBe(
			true,
		);
		const compose = readFileSync(
			join(rootDir, "prototypes", "my-snapshot", "compose.yaml"),
			"utf-8",
		);
		expect(compose).toContain("image: sumeru/my-snapshot:dev");
		const prototypeYaml = readFileSync(
			join(rootDir, "data", "prototypes", "my-snapshot.yaml"),
			"utf-8",
		);
		expect(prototypeYaml).toContain("name: my-snapshot");
	});

	it("returns 404 for missing sessions", async () => {
		const { server } = await startTestServer();
		const response = await request(
			server,
			"POST",
			"/sessions/ses_missing/commands",
			JSON.stringify({ type: "exec", command: "echo hi" }),
		);
		expect(response.status).toBe(404);
		expect(response.body).toMatchObject({
			type: "@sumeru/error",
			value: { error: "session_not_found" },
		});
	});

	it("returns 400 for invalid command bodies", async () => {
		const { server, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/commands`,
			JSON.stringify({ type: "chat" }),
		);
		expect(response.status).toBe(400);
	});

	it("keeps deprecated POST /sessions/:id/messages working", async () => {
		const { server, manager } = await startTestServer();
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const response = await request(
			server,
			"POST",
			`/sessions/${created.id}/messages`,
			JSON.stringify({ content: "legacy path" }),
		);
		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({
			type: "@sumeru/message-accepted",
			value: {
				sessionId: created.id,
				messageId: expect.stringMatching(/^msg_/),
			},
		});
	});
});

function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const tick = (): void => {
			if (predicate()) {
				resolve();
				return;
			}
			if (Date.now() - start > timeoutMs) {
				reject(new Error("timed out waiting for condition"));
				return;
			}
			setTimeout(tick, 20);
		};
		tick();
	});
}
