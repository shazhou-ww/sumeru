import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/adapter.js";
import type { SpawnArgs, StreamingSpawnFn } from "../src/types.js";

const INIT_CONFIG: AdapterInitConfig = {
	instructions: "You are a helpful assistant.",
	skills: [],
	model: { provider: "anthropic", name: "", apiKey: null },
};

const SAMPLE_NDJSON = [
	'{"type":"system","subtype":"init","session_id":"fresh-001","model":"claude-sonnet-4","cwd":"/tmp"}',
	'{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
	'{"type":"result","subtype":"success","session_id":"fresh-001","result":"hi","usage":{"input_tokens":1,"output_tokens":1}}',
].join("\n");

function makeHomeDir(): string {
	return mkdtempSync(join(tmpdir(), "cc-init-"));
}

/** Write a pre-existing session.json with a given sessionId. */
function seedSessionState(homeDir: string, sessionId: string): void {
	const stateDir = join(homeDir, ".claude-code-adapter");
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(
		join(stateDir, "session.json"),
		JSON.stringify({ sessionId, initConfig: INIT_CONFIG }),
		"utf-8",
	);
}

/** Drain a handle() generator, returning the spawn args it used. */
async function runHandleOnce(homeDir: string): Promise<SpawnArgs> {
	let captured: SpawnArgs | null = null;
	const streamingSpawnFn: StreamingSpawnFn = (args) => {
		captured = args;
		const lines = SAMPLE_NDJSON.split("\n");
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
	const adapter = createClaudeCodeAdapter({ homeDir, streamingSpawnFn });
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
	expect(captured).not.toBeNull();
	return captured as SpawnArgs;
}

describe("@sumeru/adapter-claude-code — init() sessionId preservation", () => {
	it("init() resets sessionId to null when no prior state exists", async () => {
		const homeDir = makeHomeDir();
		const adapter = createClaudeCodeAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);

		// With no prior state, init() wrote sessionId:null, so resume() loads
		// that (file exists) and native id stays null.
		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.() ?? null).toBeNull();
	});

	it("init() preserves the existing sessionId from session.json (#274)", async () => {
		const homeDir = makeHomeDir();
		const existingSessionId = "snapshot-session-7742";
		seedSessionState(homeDir, existingSessionId);

		const args = await runHandleOnce(homeDir);

		// The handle spawn must include --resume <existingSessionId>,
		// proving init() preserved the snapshot sessionId rather than
		// overwriting it with null.
		expect(args.args).toContain("--resume");
		const resumeIdx = args.args.indexOf("--resume");
		expect(args.args[resumeIdx + 1]).toBe(existingSessionId);
	});

	it("resume() restores the sessionId preserved by init()", async () => {
		const homeDir = makeHomeDir();
		const existingSessionId = "snapshot-session-9988";
		seedSessionState(homeDir, existingSessionId);

		const adapter = createClaudeCodeAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);

		// After init() preserves the state, resume() loads it.
		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.()).toBe(existingSessionId);
	});
});
