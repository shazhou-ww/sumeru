// Spec: adapter-core-dummy-lifecycle-e2e.md
// Full lifecycle over mocked stdio: init→ready, two messages each turn→done,
// then stdin close → graceful exit. No child process, no real signals.

import { describe, expect, it } from "vitest";
import type { AdapterImpl, AdapterInitConfig } from "../src/types.js";
import {
	flush,
	makeSigtermHook,
	makeStdin,
	makeStdout,
	runTestEntry,
} from "./harness.js";

describe("adapter-core — dummy adapter lifecycle (e2e)", () => {
	it("round-trips the full NDJSON protocol over mocked stdio", async () => {
		const stdin = makeStdin();
		const stdout = makeStdout();
		const initCalls: Array<AdapterInitConfig> = [];
		const seenProjects: Array<string | null> = [];

		const dummy: AdapterImpl = {
			async init(config) {
				initCalls.push(config);
			},
			async *handle(message) {
				seenProjects.push(message.project);
				yield {
					index: 0,
					role: "assistant",
					content: `echo:${message.content}`,
					timestamp: "2026-06-27T00:00:00.000Z",
					toolCalls: null,
					tokens: null,
				};
				return {
					summary: `handled ${message.messageId}`,
					tokenUsage: { input: 1, output: 2 },
				};
			},
		};

		const done = runTestEntry({
			impl: dummy,
			stdin,
			stdout: stdout.stream,
			onSigterm: makeSigtermHook().hook,
		});

		const initValue = {
			instructions: "i",
			skills: [],
			model: {
				provider: "anthropic",
				name: "m",
				apiKeyEnv: "K",
				contextWindow: 1000,
			},
		};
		stdin.write(`${JSON.stringify({ type: "init", value: initValue })}\n`);
		stdin.write(
			`${JSON.stringify({ type: "message", value: { messageId: "msg_A", content: "alpha", project: null } })}\n`,
		);
		stdin.write(
			`${JSON.stringify({ type: "message", value: { messageId: "msg_B", content: "beta", project: "proj1" } })}\n`,
		);
		await flush();
		stdin.end();
		await expect(done).resolves.toBeUndefined();

		// Init called once, deep-equal to frame value.
		expect(initCalls).toHaveLength(1);
		expect(initCalls[0]).toEqual(initValue);

		// project passthrough.
		expect(seenProjects).toEqual([null, "proj1"]);

		// Exactly 5 frames, in order.
		const frames = stdout.frames();
		expect(frames).toEqual([
			{ type: "ready", value: {} },
			{
				type: "turn",
				value: {
					index: 0,
					role: "assistant",
					content: "echo:alpha",
					timestamp: "2026-06-27T00:00:00.000Z",
					toolCalls: null,
					tokens: null,
				},
			},
			{
				type: "done",
				value: {
					summary: "handled msg_A",
					tokenUsage: { input: 1, output: 2 },
				},
			},
			{
				type: "turn",
				value: {
					index: 0,
					role: "assistant",
					content: "echo:beta",
					timestamp: "2026-06-27T00:00:00.000Z",
					toolCalls: null,
					tokens: null,
				},
			},
			{
				type: "done",
				value: {
					summary: "handled msg_B",
					tokenUsage: { input: 1, output: 2 },
				},
			},
		]);

		// Well-formed wire format: every line valid JSON, newline-terminated.
		const raw = stdout.text();
		expect(raw.endsWith("\n")).toBe(true);
		const lines = raw.split("\n").filter((l) => l.length > 0);
		expect(lines).toHaveLength(5);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});
