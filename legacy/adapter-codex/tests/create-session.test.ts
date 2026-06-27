import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import { buildJsonl, fakeSpawn, loadFixture } from "./test-utils.js";

describe("createCodexAdapter().createSession()", () => {
	it("spawns codex with the expected argv and returns a NativeSessionRef", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: loadFixture("codex-stream.success.jsonl"),
			exitCode: 0,
		});
		const adapter = createCodexAdapter({ spawnFn, model: null });
		const ref = await adapter.createSession({
			model: "o3",
			cwd: null,
		});

		expect(calls.length).toBe(1);
		expect(calls[0]?.command).toBe("codex");
		expect(calls[0]?.args).toEqual([
			"exec",
			"ping",
			"--json",
			"--dangerously-bypass-approvals-and-sandbox",
			"--skip-git-repo-check",
			"-C",
			process.cwd(),
			"-m",
			"o3",
		]);
		expect(ref.nativeId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
		expect(ref.meta.cwd).toBe(process.cwd());
		// Model comes from config since stream doesn't emit it
		expect(ref.meta.model).toBe("o3");
		expect(ref.meta.subtype).toBe("success");
		expect(typeof ref.meta.createdAt).toBe("string");
	});

	it("always uses fixed 'ping' prompt", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-default" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args[0]).toBe("exec");
		expect(calls[0]?.args[1]).toBe("ping");
	});

	it("does not pass -m when neither config nor constructor specify one", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-no-model" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args).not.toContain("-m");
	});

	it("uses constructor model when config does not provide one", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-ctor-model" }),
		});
		const adapter = createCodexAdapter({
			spawnFn,
			model: "gpt-4o",
		});
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args).toContain("-m");
		const idx = calls[0]?.args.indexOf("-m") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("gpt-4o");
	});

	it("config.model overrides constructor.model", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-config-model" }),
		});
		const adapter = createCodexAdapter({
			spawnFn,
			model: "ctor-model",
		});
		await adapter.createSession({ model: "config-model", cwd: null });
		const idx = calls[0]?.args.indexOf("-m") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("config-model");
	});

	it("populates the in-memory turn cache so getTurns returns >0 turns", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: loadFixture("codex-stream.success.jsonl"),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		// All turns from real Codex are assistant (no user events in the stream)
		expect(turns[0]?.role).toBe("assistant");
	});

	it("rejects when json output is unparseable (no session / no result)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "not json at all\nalso not json\n",
			exitCode: 0,
		});
		const adapter = createCodexAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/unparseable json/);
	});

	it("rejects with an API key error when stderr matches API key patterns", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "OPENAI_API_KEY environment variable not set or invalid api key",
			exitCode: 1,
		});
		const adapter = createCodexAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/API key/i);
	});

	it("rejects on timeout", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
		});
		const adapter = createCodexAdapter({
			spawnFn,
			createSessionTimeoutMs: 100,
		});
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/createSession timed out after 100ms/);
	});

	it("does NOT pass resume on a fresh createSession", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-fresh" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args).not.toContain("resume");
	});

	it("two parallel createSession calls return distinct nativeIds", async () => {
		let counter = 0;
		const { spawnFn } = fakeSpawn(() => ({
			stdout: buildJsonl({ sessionId: `sess-${counter++}` }),
		}));
		const adapter = createCodexAdapter({ spawnFn });
		const [a, b] = await Promise.all([
			adapter.createSession({ model: null, cwd: null }),
			adapter.createSession({ model: null, cwd: null }),
		]);
		expect(a.nativeId).not.toBe(b.nativeId);
	});

	it("uses config.cwd when provided", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-cwd" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: "/tmp/xx" });
		expect(calls[0]?.cwd).toBe("/tmp/xx");
	});

	it("uses options.cwd as fallback when config.cwd is null", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-cwd-fallback" }),
		});
		const adapter = createCodexAdapter({ spawnFn, cwd: "/tmp/yy" });
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.cwd).toBe("/tmp/yy");
	});

	it("respects dangerouslyBypassApprovals option", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-bypass" }),
		});
		const adapter = createCodexAdapter({
			spawnFn,
			dangerouslyBypassApprovals: false,
		});
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args).not.toContain(
			"--dangerously-bypass-approvals-and-sandbox",
		);
	});

	it("respects skipGitRepoCheck option", async () => {
		const { calls, spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-git" }),
		});
		const adapter = createCodexAdapter({
			spawnFn,
			skipGitRepoCheck: false,
		});
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args).not.toContain("--skip-git-repo-check");
	});

	it("rejects with non-zero-exit error when output is unparseable AND exit code is non-zero", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "boom: something bad happened",
			exitCode: 2,
		});
		const adapter = createCodexAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/exited with code 2/);
	});
});
