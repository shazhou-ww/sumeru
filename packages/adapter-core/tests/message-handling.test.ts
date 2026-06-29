// Spec: adapter-core-message-handling.md

import type { DoneValue, InboxMessage, TurnValue } from "@sumeru/adapter-core";
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
			apiKey: "test-key",
			contextWindow: 1000,
		},
	},
});

function turn(index: number, content: string): TurnValue {
	return {
		index,
		role: "assistant",
		content,
		timestamp: `2026-06-27T00:00:0${index}.000Z`,
		toolCalls: null,
		tokens: null,
	};
}

describe("adapter-core — message handling", () => {
	it("each yield → turn, return → exactly one done, in order", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const handleCalls: Array<InboxMessage> = [];
		const impl: AdapterImpl = {
			async init() {},
			async *handle(message): AsyncGenerator<TurnValue, DoneValue> {
				handleCalls.push(message);
				yield turn(0, `re: ${message.content}`);
				yield turn(1, "done thinking");
				return { summary: "ok", tokenUsage: { input: 10, output: 20, cached: 0 } };
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
			`${JSON.stringify({
				type: "message",
				value: { messageId: "msg_01JXYZ", content: "hello", project: null },
			})}\n`,
		);
		await flush();
		stdin.end();
		await done;

		expect(handleCalls).toHaveLength(1);
		expect(handleCalls[0]).toEqual({
			messageId: "msg_01JXYZ",
			content: "hello",
			project: null,
		});

		const frames = stdout.frames();
		expect(frames).toEqual([
			{ type: "ready", value: {} },
			{ type: "turn", value: turn(0, "re: hello") },
			{ type: "turn", value: turn(1, "done thinking") },
			{
				type: "done",
				value: { summary: "ok", tokenUsage: { input: 10, output: 20, cached: 0 } },
			},
		]);
	});

	it("streams turns as yielded (turn #0 visible before deferred resolves)", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const gate = createDeferred<void>();
		const impl: AdapterImpl = {
			async init() {},
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				yield turn(0, "first");
				await gate.promise;
				yield turn(1, "second");
				return { summary: null, tokenUsage: null };
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
			`${JSON.stringify({
				type: "message",
				value: { messageId: "m", content: "c", project: null },
			})}\n`,
		);
		await flush();

		// turn #0 flushed before gate resolves; no done yet.
		const early = stdout.frames();
		expect(early).toContainEqual({ type: "turn", value: turn(0, "first") });
		expect(early.some((f) => f.type === "done")).toBe(false);
		expect(early.some((f) => f.type === "turn" && f.value.index === 1)).toBe(
			false,
		);

		gate.resolve();
		await flush();
		stdin.end();
		await done;

		const frames = stdout.frames();
		expect(frames.at(-1)).toEqual({
			type: "done",
			value: { summary: null, tokenUsage: null },
		});
	});

	it("two messages: sequential, non-interleaving, single ready, no re-init", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		let initCount = 0;
		const impl: AdapterImpl = {
			async init() {
				initCount += 1;
			},
			async *handle(message): AsyncGenerator<TurnValue, DoneValue> {
				yield turn(0, `t:${message.messageId}`);
				return { summary: message.messageId, tokenUsage: null };
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
			`${JSON.stringify({ type: "message", value: { messageId: "A", content: "a", project: null } })}\n`,
		);
		stdin.write(
			`${JSON.stringify({ type: "message", value: { messageId: "B", content: "b", project: null } })}\n`,
		);
		await flush();
		stdin.end();
		await done;

		expect(initCount).toBe(1);
		const frames = stdout.frames();
		expect(frames.filter((f) => f.type === "ready")).toHaveLength(1);
		expect(frames).toEqual([
			{ type: "ready", value: {} },
			{ type: "turn", value: turn(0, "t:A") },
			{ type: "done", value: { summary: "A", tokenUsage: null } },
			{ type: "turn", value: turn(0, "t:B") },
			{ type: "done", value: { summary: "B", tokenUsage: null } },
		]);
	});

	it("empty generator → zero turns, exactly one done", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const impl: AdapterImpl = {
			async init() {},
			// biome-ignore lint/correctness/useYield: empty generator is the scenario
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				return { summary: "empty", tokenUsage: null };
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
		expect(frames.filter((f) => f.type === "turn")).toHaveLength(0);
		expect(frames.filter((f) => f.type === "done")).toEqual([
			{ type: "done", value: { summary: "empty", tokenUsage: null } },
		]);
	});
});
