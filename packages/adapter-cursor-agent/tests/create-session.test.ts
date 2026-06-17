import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

describe("createSession", () => {
	it("returns a NativeSessionRef with session id from the system line", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "Say hi." });
		expect(ref.nativeId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
		expect(ref.meta.cwd).toBeDefined();
		expect(ref.meta.model).toBe("claude-sonnet-4");
		expect(ref.meta.createdAt).toBeDefined();
		expect(ref.meta.subtype).toBe("success");
	});

	it("uses 'ping' as default query when initialQuery is empty", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({});
		expect(calls[0]?.args[1]).toBe("ping");
	});

	it("passes initialQuery via argv", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ initialQuery: "Hello world!" });
		expect(calls[0]?.args[1]).toBe("Hello world!");
	});

	it("includes --print --output-format stream-json --trust --force flags", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({});
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
		await adapter.createSession({});
		const args = calls[0]?.args;
		const wsIdx = args.indexOf("--workspace");
		expect(wsIdx).toBeGreaterThan(-1);
		expect(args[wsIdx + 1]).toBe("/my/workspace");
	});

	it("passes --model when model is specified in config", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ model: "sonnet-4", initialQuery: "hi" });
		const args = calls[0]?.args;
		expect(args).toContain("--model");
		expect(args).toContain("sonnet-4");
	});

	it("does not pass --model when model is null", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await adapter.createSession({ initialQuery: "hi" });
		const args = calls[0]?.args;
		expect(args).not.toContain("--model");
	});

	it("passes --yolo when permissionMode is yolo", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			permissionMode: "yolo",
		});
		await adapter.createSession({});
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
		await adapter.createSession({});
		const args = calls[0]?.args;
		expect(args).toContain("--sandbox");
		expect(args).toContain("enabled");
	});

	it("populates the turn cache on successful createSession", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "Say hi." });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns[0]?.role).toBe("user");
	});

	it("rejects when spawn fails (bad binary path)", async () => {
		const { spawnFn } = fakeSpawn(() => {
			throw new Error("ENOENT");
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(/ENOENT/);
	});

	it("rejects with unparseable error when stdout is blank", async () => {
		const { spawnFn } = fakeSpawn({ stdout: "\n\n\n" });
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(/unparseable/);
	});

	it("rejects with API key error when stderr matches pattern", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "Error: CURSOR_API_KEY is not set",
			exitCode: 1,
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(
			/cursor-agent API key error/,
		);
	});

	it("rejects with trust error when stderr matches trust pattern", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "Error: workspace not trusted",
			exitCode: 1,
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(/requires --trust/);
	});

	it("rejects with timeout error when timedOut is true", async () => {
		const { spawnFn } = fakeSpawn({ stdout: "", timedOut: true });
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.createSession({})).rejects.toThrow(/timed out/);
	});

	it("two parallel createSession calls return distinct nativeIds", async () => {
		let callCount = 0;
		const { spawnFn } = fakeSpawn(() => {
			const id = `session-${callCount++}`;
			return { stdout: buildNdjson({ sessionId: id }) };
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const [ref1, ref2] = await Promise.all([
			adapter.createSession({}),
			adapter.createSession({}),
		]);
		expect(ref1.nativeId).not.toBe(ref2.nativeId);
	});

	it("handles unicode/special characters in initialQuery", async () => {
		const { calls, spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const query = 'Say "hello"\nnewline\t🎉';
		await adapter.createSession({ initialQuery: query });
		expect(calls[0]?.args[1]).toBe(query);
	});
});
