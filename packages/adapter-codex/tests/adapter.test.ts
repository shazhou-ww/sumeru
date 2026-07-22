import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/adapter.js";
import type { SpawnArgs, StreamingSpawnFn } from "../src/types.js";

const INIT_CONFIG: AdapterInitConfig = {
	instructions: "You are the codex agent.",
	skills: [{ name: "demo", content: "demo skill body" }],
	model: {
		provider: "openai",
		name: "gpt-5",
		apiKey: "test-key",
		contextWindow: 200_000,
	},
};

const SAMPLE_JSONL = [
	'{"type":"thread.started","thread_id":"thread_abc"}',
	'{"type":"item.completed","item":{"type":"agent_message","text":"hello from codex"}}',
	'{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
].join("\n");

describe("@sumeru/adapter-codex — adapter", () => {
	it("exports createCodexAdapter returning AdapterImpl shape", () => {
		const adapter = createCodexAdapter();
		expect(typeof adapter.init).toBe("function");
		expect(typeof adapter.handle).toBe("function");
		expect(typeof adapter.getNativeId).toBe("function");
	});

	it("init writes AGENTS.md and skills under the configured home dir", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "codex-init-"));
		const adapter = createCodexAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);

		const agents = await readFile(join(homeDir, "AGENTS.md"), "utf-8");
		expect(agents).toBe(INIT_CONFIG.instructions);
		const skill = await readFile(
			join(homeDir, ".codex", "skills", "demo", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("demo skill body");
	});

	it("handle spawns codex exec and yields assistant turns", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "codex-handle-"));
		const spawnCalls: Array<SpawnArgs> = [];
		const streamingSpawnFn: StreamingSpawnFn = (args) => {
			spawnCalls.push(args);
			const lines = SAMPLE_JSONL.split("\n");
			async function* generator(): AsyncGenerator<string> {
				for (const line of lines) {
					yield line;
				}
			}
			return {
				lines: generator(),
				waitForExit: async () => ({
					exitCode: 0,
					signal: null,
					timedOut: false,
					durationMs: 20,
					stderr: "",
				}),
			};
		};

		const adapter = createCodexAdapter({ homeDir, streamingSpawnFn });
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_1",
			content: "ping",
			project: null,
		});

		const turns = [];
		while (true) {
			const step = await generator.next();
			if (step.done === true) {
				expect(step.value.tokenUsage).toEqual({
					input: 10,
					output: 5,
					cached: 0,
				});
				break;
			}
			turns.push(step.value);
		}

		expect(turns).toHaveLength(1);
		expect(turns[0]?.content).toBe("hello from codex");
		expect(spawnCalls[0]?.command).toBe("codex");
		expect(spawnCalls[0]?.args[0]).toBe("exec");
		expect(spawnCalls[0]?.args).toContain("ping");
		expect(adapter.getNativeId?.()).toBe("thread_abc");
	});
});

describe("@sumeru/adapter-codex — init() sessionId preservation (#274)", () => {
	function seedSessionState(homeDir: string, sessionId: string): void {
		const stateDir = join(homeDir, ".codex-adapter");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(
			join(stateDir, "session.json"),
			JSON.stringify({ sessionId, initConfig: INIT_CONFIG }),
			"utf-8",
		);
	}

	async function runHandleOnce(homeDir: string): Promise<SpawnArgs> {
		const spawnCalls: Array<SpawnArgs> = [];
		const streamingSpawnFn: StreamingSpawnFn = (args) => {
			spawnCalls.push(args);
			const lines = SAMPLE_JSONL.split("\n");
			async function* gen(): AsyncGenerator<string> {
				for (const line of lines) yield line;
			}
			return {
				lines: gen(),
				waitForExit: async () => ({
					exitCode: 0,
					signal: null,
					timedOut: false,
					durationMs: 5,
					stderr: "",
				}),
			};
		};
		const adapter = createCodexAdapter({ homeDir, streamingSpawnFn });
		await adapter.init(INIT_CONFIG);
		// Runtime path: resume() reloads the preserved sessionId into memory
		// before handle() uses it to build the --resume arg.
		await adapter.resume();

		const gen = adapter.handle({
			messageId: "m1",
			content: "hello",
			project: null,
		});
		while (!(await gen.next()).done) {
			// drain
		}
		expect(spawnCalls.length).toBe(1);
		return spawnCalls[0] as SpawnArgs;
	}

	it("init() resets sessionId to null when no prior state exists", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "codex-init-nostate-"));
		const adapter = createCodexAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);
		// With no prior state, init() wrote sessionId:null, so resume() loads
		// that (file exists) and native id stays null.
		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.() ?? null).toBeNull();
	});

	it("init() preserves the existing sessionId from session.json", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "codex-init-preserve-"));
		const existingSessionId = "snapshot-thread-7742";
		seedSessionState(homeDir, existingSessionId);

		const args = await runHandleOnce(homeDir);

		// handle must resume into the snapshot session, not start fresh.
		expect(args.args).toContain("resume");
		const resumeIdx = args.args.indexOf("resume");
		expect(args.args[resumeIdx + 1]).toBe(existingSessionId);
	});

	it("resume() restores the sessionId preserved by init()", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "codex-init-resume-"));
		const existingSessionId = "snapshot-thread-9988";
		seedSessionState(homeDir, existingSessionId);

		const adapter = createCodexAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);

		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.()).toBe(existingSessionId);
	});
});
