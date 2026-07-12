// Spec: adapter-core-resume-handshake.md

import { afterEach, describe, expect, it } from "vitest";
import type { HarnessConfig } from "../src/harness-types.js";
import { runSessionLoop } from "../src/session-loop.js";
import type { AdapterImpl } from "../src/types.js";
import {
	flush,
	makeSigtermHook,
	makeStdin,
	makeStdout,
	runTestEntry,
} from "./harness.js";

const emptyHarness: HarnessConfig = {
	resetPaths: [],
	modelConfigPath: null,
	personaPath: null,
	skillsDir: null,
	writeModelConfig: null,
	installSkill: null,
};

describe("adapter-core — resume handshake", () => {
	let stdin = makeStdin();

	afterEach(() => {
		stdin.end();
	});

	it("resume() true emits ready before any init frame (entrypoint)", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const impl: AdapterImpl = {
			async init() {
				throw new Error("init should not be called");
			},
			resume() {
				return true;
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

		await flush();
		expect(stdout.frames()).toEqual([{ type: "ready", value: {} }]);

		stdin.end();
		await done;
	});

	it("resume() true emits ready before any init frame (session loop)", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const impl: AdapterImpl = {
			async init() {
				throw new Error("init should not be called");
			},
			resume() {
				return true;
			},
			// biome-ignore lint/correctness/useYield: never called in this spec
			async *handle() {
				throw new Error("handle should not be called");
			},
		};

		const done = runSessionLoop({
			harness: emptyHarness,
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
			sendTimeoutMs: null,
		});

		await flush();
		expect(stdout.frames()).toEqual([{ type: "ready", value: {} }]);

		stdin.end();
		await done;
	});

	it("resume() false still requires init", async () => {
		stdin = makeStdin();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		let initCalled = false;
		const impl: AdapterImpl = {
			async init() {
				initCalled = true;
			},
			resume() {
				return false;
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

		await flush();
		expect(stdout.frames()).toEqual([]);

		stdin.write(
			`${JSON.stringify({
				type: "init",
				value: {
					instructions: "test",
					skills: [],
					model: {
						provider: "anthropic",
						name: "claude-sonnet-4",
						apiKey: "test-key",
					},
				},
			})}\n`,
		);
		await flush();
		expect(initCalled).toBe(true);
		expect(stdout.frames()).toEqual([{ type: "ready", value: {} }]);

		stdin.end();
		await done;
	});
});
