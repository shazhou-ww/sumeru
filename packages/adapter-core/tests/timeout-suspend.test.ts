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

describe("adapter-core — timeout suspend", () => {
	it("handle exceeding sendTimeoutMs emits suspend then exits", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const gate = createDeferred<void>();
		const impl: AdapterImpl = {
			async init() {},
			getNativeId() {
				return "native-timeout-1";
			},
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				yield {
					index: 0,
					role: "assistant",
					content: "slow",
					timestamp: "t",
					toolCalls: null,
					tokens: null,
				};
				await gate.promise;
				return { summary: "never", tokenUsage: null };
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
			sendTimeoutMs: 30,
		});

		stdin.write(`${INIT_LINE}\n`);
		stdin.write(
			`${JSON.stringify({
				type: "message",
				value: {
					messageId: "m",
					content: "c",
					project: null,
				},
			})}\n`,
		);
		await flush();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await done;

		const frames = stdout.frames();
		expect(frames.some((f) => f.type === "done")).toBe(false);
		expect(frames.some((f) => f.type === "error")).toBe(false);
		const suspend = frames.find((f) => f.type === "suspend");
		expect(suspend).toEqual({
			type: "suspend",
			value: {
				reason: "timeout",
				elapsedMs: expect.any(Number),
				nativeId: "native-timeout-1",
			},
		});
		expect((suspend?.value as { elapsedMs: number }).elapsedMs).toBeGreaterThan(
			0,
		);
	}, 1_000);
});
