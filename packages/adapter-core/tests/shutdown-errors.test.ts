// Spec: adapter-core-shutdown-and-errors.md

import type { DoneValue, TurnValue } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import type { AdapterImpl } from "../src/types.js";
import {
	createDeferred,
	flush,
	makeSigtermHook,
	makeStdin,
	makeStdout,
	runTestEntry,
} from "./harness.js";

const INIT_LINE = JSON.stringify({
	type: "init",
	value: {
		instructions: "i",
		skills: [],
		model: {
			provider: "anthropic",
			name: "m",
			apiKeyEnv: "K",
			contextWindow: 1000,
		},
	},
});

// biome-ignore lint/correctness/useYield: idle adapter that only returns a done value
const noopHandle = async function* (): AsyncGenerator<TurnValue, DoneValue> {
	return { summary: null, tokenUsage: null };
};

describe("adapter-core — shutdown & errors", () => {
	it("EOF while idle → clean completion, no error frame", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const impl: AdapterImpl = { async init() {}, handle: noopHandle };

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		await flush();
		stdin.end();
		await expect(done).resolves.toBeUndefined();

		expect(stdout.frames().some((f) => f.type === "error")).toBe(false);
	});

	it("EOF mid-handle → in-flight generator drains to done before shutdown", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const gate = createDeferred<void>();
		const impl: AdapterImpl = {
			async init() {},
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				yield {
					index: 0,
					role: "assistant",
					content: "partial",
					timestamp: "t",
					toolCalls: null,
					tokens: null,
				};
				await gate.promise;
				return { summary: "finished", tokenUsage: null };
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		stdin.write(
			`${JSON.stringify({ type: "message", value: { messageId: "m", content: "c", project: null } })}\n`,
		);
		await flush();
		// EOF arrives while handle is suspended on the gate.
		stdin.end();
		await flush();
		gate.resolve();
		await done;

		const frames = stdout.frames();
		// no turn was lost; done was emitted.
		expect(frames).toContainEqual({
			type: "turn",
			value: {
				index: 0,
				role: "assistant",
				content: "partial",
				timestamp: "t",
				toolCalls: null,
				tokens: null,
			},
		});
		expect(frames.at(-1)).toEqual({
			type: "done",
			value: { summary: "finished", tokenUsage: null },
		});
	});

	it("SIGTERM → graceful shutdown, idempotent (second SIGTERM is a no-op)", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const impl: AdapterImpl = { async init() {}, handle: noopHandle };

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		await flush();
		expect(sigterm.registered()).toBe(true);

		sigterm.fire();
		sigterm.fire(); // idempotent
		await expect(done).resolves.toBeUndefined();

		const frames = stdout.frames();
		expect(frames).toEqual([{ type: "ready", value: {} }]);
		expect(sigterm.disposed()).toBe(true);
	});

	it("malformed line (invalid JSON) → single protocol_error, process survives", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const impl: AdapterImpl = { async init() {}, handle: noopHandle };

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		stdin.write("not json at all\n");
		await flush();
		stdin.end();
		await done;

		const errors = stdout.frames().filter((f) => f.type === "error");
		expect(errors).toHaveLength(1);
		expect((errors[0] as { value: { code: string } }).value.code).toBe(
			"protocol_error",
		);
	});

	it("unknown frame type → protocol_error", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const impl: AdapterImpl = { async init() {}, handle: noopHandle };

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		stdin.write(`${JSON.stringify({ type: "bogus" })}\n`);
		await flush();
		stdin.end();
		await done;

		const errors = stdout.frames().filter((f) => f.type === "error");
		expect(errors).toHaveLength(1);
		expect((errors[0] as { value: { code: string } }).value.code).toBe(
			"protocol_error",
		);
	});

	it("message before init → init_required error, handle not called", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		let handleCalled = false;
		const impl: AdapterImpl = {
			async init() {},
			// biome-ignore lint/correctness/useYield: must not be called (pre-init guard)
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				handleCalled = true;
				return { summary: null, tokenUsage: null };
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		stdin.write(
			`${JSON.stringify({ type: "message", value: { messageId: "m", content: "c", project: null } })}\n`,
		);
		await flush();
		stdin.end();
		await done;

		expect(handleCalled).toBe(false);
		const errors = stdout.frames().filter((f) => f.type === "error");
		expect(errors).toHaveLength(1);
		expect((errors[0] as { value: { code: string } }).value.code).toBe(
			"init_required",
		);
	});

	it("handle throws → single handler_error frame, no done", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const impl: AdapterImpl = {
			async init() {},
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				yield {
					index: 0,
					role: "assistant",
					content: "x",
					timestamp: "t",
					toolCalls: null,
					tokens: null,
				};
				throw new Error("kaboom");
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		stdin.write(
			`${JSON.stringify({ type: "message", value: { messageId: "m", content: "c", project: null } })}\n`,
		);
		await flush();
		stdin.end();
		await done;

		const frames = stdout.frames();
		expect(frames.some((f) => f.type === "done")).toBe(false);
		const errors = frames.filter((f) => f.type === "error");
		expect(errors).toHaveLength(1);
		const err = errors[0] as { value: { code: string; message: string } };
		expect(err.value.code).toBe("handler_error");
		expect(err.value.message).toContain("kaboom");
	});
});
