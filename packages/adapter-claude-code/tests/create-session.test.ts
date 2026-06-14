import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn, loadFixture } from "./test-utils.js";

describe("createClaudeCodeAdapter().createSession()", () => {
	it("spawns claude with the expected argv and returns a NativeSessionRef", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: loadFixture("cc-stream.success.ndjson"),
			exitCode: 0,
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, model: null });
		const ref = await adapter.createSession({
			model: "claude-sonnet-4-5",
			initialQuery: "Say hi.",
		});

		expect(calls.length).toBe(1);
		expect(calls[0]?.command).toBe("claude");
		expect(calls[0]?.args).toEqual([
			"-p",
			"Say hi.",
			"--output-format",
			"stream-json",
			"--verbose",
			"--dangerously-skip-permissions",
			"--max-turns",
			"90",
			"--model",
			"claude-sonnet-4-5",
		]);
		expect(ref.nativeId).toBe("a1b2c3d4-1111-2222-3333-444455556666");
		expect(ref.meta.cwd).toBe(process.cwd());
		expect(ref.meta.model).toBe("claude-sonnet-4-5");
		expect(ref.meta.subtype).toBe("success");
		expect(typeof ref.meta.createdAt).toBe("string");
	});

	it("defaults initialQuery to 'ping' when missing or empty", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-default" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await adapter.createSession({});
		expect(calls[0]?.args[0]).toBe("-p");
		expect(calls[0]?.args[1]).toBe("ping");

		await adapter.createSession({ initialQuery: "" });
		expect(calls[1]?.args[1]).toBe("ping");
	});

	it("does not pass --model when neither config nor constructor specify one", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-no-model", model: "" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await adapter.createSession({});
		expect(calls[0]?.args).not.toContain("--model");
	});

	it("uses constructor model when config does not provide one", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-ctor-model" }),
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			model: "claude-3-5-sonnet",
		});
		await adapter.createSession({});
		expect(calls[0]?.args).toContain("--model");
		const idx = calls[0]?.args.indexOf("--model") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("claude-3-5-sonnet");
	});

	it("config.model overrides constructor.model", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-config-model" }),
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			model: "ctor-model",
		});
		await adapter.createSession({ model: "config-model" });
		const idx = calls[0]?.args.indexOf("--model") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("config-model");
	});

	it("populates the in-memory turn cache so getTurns returns >0 turns", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: loadFixture("cc-stream.success.ndjson"),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "Say hi." });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns[0]?.role).toBe("user");
	});

	it("rejects when stream-json is unparseable (no system / no result)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: loadFixture("cc-stream.malformed.ndjson"),
			exitCode: 0,
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(
			/unparseable stream-json/,
		);
	});

	it("rejects with a not-logged-in message when stderr indicates login required", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "Error: Not logged in. Please run 'claude login'.",
			exitCode: 1,
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(/not logged in/i);
	});

	it("rejects with an API key error when stderr matches API key patterns", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr:
				"ANTHROPIC_API_KEY environment variable not set or invalid api key",
			exitCode: 1,
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(/API key/i);
	});

	it("rejects on timeout", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			createSessionTimeoutMs: 100,
		});
		await expect(adapter.createSession({})).rejects.toThrow(
			/createSession timed out after 100ms/,
		);
	});

	it("does NOT pass --resume on a fresh createSession", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-fresh" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await adapter.createSession({});
		expect(calls[0]?.args).not.toContain("--resume");
	});

	it("error_max_turns at init resolves cleanly with subtype reflected in meta", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: loadFixture("cc-stream.max-turns.ndjson"),
			exitCode: 0,
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		expect(ref.meta.subtype).toBe("error_max_turns");
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
	});

	it("two parallel createSession calls return distinct nativeIds", async () => {
		let counter = 0;
		const { spawnFn } = fakeSpawn(() => ({
			stdout: buildNdjson({ sessionId: `sess-${counter++}` }),
		}));
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const [a, b] = await Promise.all([
			adapter.createSession({}),
			adapter.createSession({}),
		]);
		expect(a.nativeId).not.toBe(b.nativeId);
	});

	it("argv passes unicode/quotes verbatim (no shell interpolation)", async () => {
		const tricky = 'line1\nline2 中文 🍊 "quoted" \\back';
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-unicode", userText: tricky }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await adapter.createSession({ initialQuery: tricky });
		expect(calls[0]?.args[1]).toBe(tricky);
	});

	it("uses options.cwd when provided", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-cwd" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, cwd: "/tmp/xx" });
		await adapter.createSession({});
		expect(calls[0]?.cwd).toBe("/tmp/xx");
	});

	it("uses constructor maxTurns when provided", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-maxt" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, maxTurns: 7 });
		await adapter.createSession({});
		const idx = calls[0]?.args.indexOf("--max-turns") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("7");
	});

	it("rejects with non-zero-exit error when stream is unparseable AND exit code is non-zero", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "boom: something bad happened",
			exitCode: 2,
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(
			/exited with code 2/,
		);
	});
});
