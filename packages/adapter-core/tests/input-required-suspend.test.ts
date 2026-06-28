import type { DoneValue } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import type { AdapterHandleYield, AdapterImpl } from "../src/types.js";
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

describe("adapter-core — inputRequired suspend", () => {
	it("impl yield suspend emits suspend then exits without timeout", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const gate = createDeferred<void>();
		const impl: AdapterImpl = {
			async init() {},
			getNativeId() {
				return "native-input-required-1";
			},
			async *handle(): AsyncGenerator<AdapterHandleYield, DoneValue> {
				yield {
					index: 0,
					role: "assistant",
					content: "need input",
					timestamp: "t",
					toolCalls: null,
					tokens: null,
				};
				yield {
					type: "suspend",
					value: { reason: "inputRequired", elapsedMs: 12 },
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
		expect(frames.map((f) => f.type)).toEqual(["ready", "turn", "suspend"]);
		const suspend = frames.find((f) => f.type === "suspend");
		expect(suspend).toEqual({
			type: "suspend",
			value: {
				reason: "inputRequired",
				elapsedMs: 12,
				nativeId: "native-input-required-1",
			},
		});
	}, 1_000);
});
