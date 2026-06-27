// Spec: adapter-core-init-ready-handshake.md

import type { AdapterInitConfig } from "@sumeru/core";
import { afterEach, describe, expect, it } from "vitest";
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
		instructions: "You are a worker.",
		skills: [{ name: "tdd", content: "# TDD" }],
		model: {
			provider: "anthropic",
			name: "claude-sonnet-4",
			apiKeyEnv: "ANTHROPIC_API_KEY",
			contextWindow: 200000,
		},
	},
});

describe("adapter-core — init/ready handshake", () => {
	let stdin = makeStdin();

	afterEach(() => {
		stdin.end();
	});

	it("calls init exactly once with the frame value and emits one ready", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const initCalls: Array<unknown> = [];
		const impl: AdapterImpl = {
			async init(config) {
				initCalls.push(config);
			},
			// biome-ignore lint/correctness/useYield: never called in this spec
			async *handle() {
				throw new Error("handle should not be called");
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		await flush();
		stdin.end();
		await done;

		expect(initCalls).toHaveLength(1);
		expect(initCalls[0]).toEqual(JSON.parse(INIT_LINE).value);
		const frames = stdout.frames();
		expect(frames).toEqual([{ type: "ready", value: {} }]);
	});

	it("awaits init before writing ready (no bytes until init resolves)", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const gate = createDeferred<void>();
		const impl: AdapterImpl = {
			async init() {
				await gate.promise;
			},
			// biome-ignore lint/correctness/useYield: never called in this spec
			async *handle() {
				throw new Error("handle should not be called");
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		await flush();
		// init is blocked → no stdout yet.
		expect(stdout.text()).toBe("");

		gate.resolve();
		await flush();
		expect(stdout.frames()).toEqual([{ type: "ready", value: {} }]);

		stdin.end();
		await done;
	});

	it("init rejection → no ready, terminal error frame with init code", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const impl: AdapterImpl = {
			async init() {
				throw new Error("boom");
			},
			// biome-ignore lint/correctness/useYield: never called in this spec
			async *handle() {
				throw new Error("handle should not be called");
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		await flush();
		stdin.end();
		await done;

		const frames = stdout.frames();
		expect(frames).toHaveLength(1);
		expect(frames[0]).toMatchObject({ type: "error" });
		const frame = frames[0] as {
			type: "error";
			value: { code: string; message: string };
		};
		expect(frame.value.code).toBe("init_error");
		expect(frame.value.message).toContain("boom");
		expect(frames.some((f) => f.type === "ready")).toBe(false);
	});

	it("ready is the first outbound frame (init produces no turn/done)", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const config: AdapterInitConfig = JSON.parse(INIT_LINE).value;
		const impl: AdapterImpl = {
			async init(c) {
				expect(c).toEqual(config);
			},
			// biome-ignore lint/correctness/useYield: never called in this spec
			async *handle() {
				throw new Error("handle should not be called");
			},
		};

		const done = runTestEntry({
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${INIT_LINE}\n`);
		await flush();
		stdin.end();
		await done;

		const frames = stdout.frames();
		expect(frames[0]).toEqual({ type: "ready", value: {} });
		expect(
			frames.filter((f) => f.type === "turn" || f.type === "done"),
		).toEqual([]);
	});
});
