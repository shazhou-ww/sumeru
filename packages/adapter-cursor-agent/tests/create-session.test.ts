import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

describe("createSession", () => {
	it("returns a NativeSessionRef with session id from the system line", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		expect(ref.nativeId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
		expect(ref.meta.cwd).toBeDefined();
		expect(ref.meta.model).toBe("claude-sonnet-4");
		expect(ref.meta.createdAt).toBeDefined();
		expect(ref.meta.subtype).toBe("success");
	});

	it("always uses 'ping' as the prompt", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args[1]).toBe("ping");
	});

	it("includes --print --output-format stream-json --trust --force flags", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: null });
		const args = calls[0]?.args;
		expect(args).toContain("--print");
		expect(args).toContain("--output-format");
		expect(args).toContain("stream-json");
		expect(args).toContain("--trust");
		expect(args).toContain("--force");
	});

	it("includes --workspace with cwd", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/my/workspace" });
		await adapter.createSession({ model: null, cwd: null });
		const args = calls[0]?.args;
		const wsIdx = args.indexOf("--workspace");
		expect(wsIdx).toBeGreaterThan(-1);
		expect(args[wsIdx + 1]).toBe("/my/workspace");
	});

	it("passes --model when model is specified in config", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ model: "sonnet-4", cwd: null });
		const args = calls[0]?.args;
		expect(args).toContain("--model");
		expect(args).toContain("sonnet-4");
	});

	it("does not pass --model when model is null", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: null });
		const args = calls[0]?.args;
		expect(args).not.toContain("--model");
	});

	it("uses config.cwd when provided", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ model: null, cwd: "/from/config" });
		expect(calls[0]?.cwd).toBe("/from/config");
		const args = calls[0]?.args;
		const wsIdx = args.indexOf("--workspace");
		expect(args[wsIdx + 1]).toBe("/from/config");
	});

	it("passes --yolo when permissionMode is yolo", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			permissionMode: "yolo",
		});
		await adapter.createSession({ model: null, cwd: null });
		const args = calls[0]?.args;
		expect(args).toContain("--yolo");
		expect(args).not.toContain("--force");
	});

	it("passes --sandbox when sandbox is set", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			sandbox: "enabled",
		});
		await adapter.createSession({ model: null, cwd: null });
		const args = calls[0]?.args;
		expect(args).toContain("--sandbox");
		expect(args).toContain("enabled");
	});

	it("populates the turn cache on successful createSession", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns[0]?.role).toBe("user");
	});

	it("rejects when spawn fails (bad binary path)", async () => {
		const { spawnFn } = fakeSpawn(() => {
			throw new Error("ENOENT");
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/ENOENT/);
	});

	it("rejects with unparseable error when stdout is blank", async () => {
		const { spawnFn } = fakeSpawn({ stdout: "\n\n\n" });
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/unparseable/);
	});

	it("rejects with API key error when stderr matches pattern", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "Error: CURSOR_API_KEY is not set",
			exitCode: 1,
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/cursor-agent API key error/);
	});

	it("rejects with trust error when stderr matches trust pattern", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "Error: workspace not trusted",
			exitCode: 1,
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/requires --trust/);
	});

	it("rejects with timeout error when timedOut is true", async () => {
		const { spawnFn } = fakeSpawn({ stdout: "", timedOut: true });
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/timed out/);
	});

	it("two parallel createSession calls return distinct nativeIds", async () => {
		let callCount = 0;
		const { spawnFn } = fakeSpawn(() => {
			const id = `session-${callCount++}`;
			return { stdout: buildNdjson({ sessionId: id }) };
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const [ref1, ref2] = await Promise.all([
			adapter.createSession({ model: null, cwd: null }),
			adapter.createSession({ model: null, cwd: null }),
		]);
		expect(ref1.nativeId).not.toBe(ref2.nativeId);
	});

	it("constructor model is used when config.model is null", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			model: "ctor-model",
		});
		await adapter.createSession({ model: null, cwd: null });
		expect(calls[0]?.args).toContain("--model");
		const idx = calls[0]?.args.indexOf("--model") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("ctor-model");
	});

	it("config.model overrides constructor model", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			model: "ctor-model",
		});
		await adapter.createSession({ model: "config-model", cwd: null });
		const idx = calls[0]?.args.indexOf("--model") ?? -1;
		expect(calls[0]?.args[idx + 1]).toBe("config-model");
	});
});
