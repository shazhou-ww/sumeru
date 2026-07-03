import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AdapterImpl, DoneValue, TurnValue } from "@sumeru/adapter-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	handleControlFrame,
	isControlFrameType,
} from "../src/control-frames.js";
import { runSessionEntry } from "../src/entrypoint.js";
import { codexHarness, formatCodexModelConfig } from "../src/harness/codex.js";
import { getHarnessConfig } from "../src/harness/index.js";
import { sarsapaHarness } from "../src/harness/sarsapa.js";

type StdoutCapture = {
	stream: NodeJS.WritableStream;
	frames(): Array<{ type: string; value?: unknown }>;
};

function makeStdout(): StdoutCapture {
	let buffer = "";
	const fake = {
		write(chunk: string | Uint8Array): boolean {
			buffer +=
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
			return true;
		},
		end(): void {},
	};
	return {
		stream: fake as unknown as NodeJS.WritableStream,
		frames: () =>
			buffer
				.split("\n")
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as { type: string; value?: unknown }),
	};
}

function makeSigtermHook() {
	let handler: (() => void) | null = null;
	return {
		hook(h: () => void) {
			handler = h;
			return () => {
				handler = null;
			};
		},
		fire() {
			handler?.();
		},
	};
}

function makeStubAdapter(): AdapterImpl {
	return {
		async init() {},
		async *handle(): AsyncGenerator<TurnValue, DoneValue> {
			if (false as boolean) {
				yield {
					index: 0,
					role: "assistant",
					content: "",
					timestamp: "",
					toolCalls: null,
					tokens: null,
				};
			}
			return { summary: "ok", tokenUsage: null };
		},
	};
}

async function flush(times = 3): Promise<void> {
	for (let i = 0; i < times; i++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

describe("isControlFrameType", () => {
	it("recognizes reset, model, and install-skill", () => {
		expect(isControlFrameType("reset")).toBe(true);
		expect(isControlFrameType("model")).toBe(true);
		expect(isControlFrameType("install-skill")).toBe(true);
		expect(isControlFrameType("init")).toBe(false);
		expect(isControlFrameType("message")).toBe(false);
	});
});

describe("handleControlFrame — sarsapa", () => {
	it("accepts reset as a no-op", async () => {
		await expect(
			handleControlFrame(sarsapaHarness, {
				type: "reset",
				value: { persona: "You are concise." },
			}),
		).resolves.toBeUndefined();
	});

	it("accepts model as a no-op when modelConfigPath is null", async () => {
		await expect(
			handleControlFrame(sarsapaHarness, {
				type: "model",
				value: {
					baseUrl: "https://example.test",
					apiKey: "sk-test",
					model: "demo-model",
				},
			}),
		).resolves.toBeUndefined();
	});

	it("accepts install-skill as a no-op when skillsDir is null", async () => {
		await expect(
			handleControlFrame(sarsapaHarness, {
				type: "install-skill",
				value: {
					name: "tdd",
					content: "Write tests first.",
					files: [],
				},
			}),
		).resolves.toBeUndefined();
	});
});

describe("handleControlFrame — hermes paths", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("writes persona and clears reset paths", async () => {
		const root = mkdtempSync(join(tmpdir(), "sumeru-session-control-"));
		tempDirs.push(root);
		const harness = {
			resetPaths: [join(root, "state")],
			modelConfigPath: null,
			personaPath: join(root, "SOUL.md"),
			skillsDir: null,
			writeModelConfig: null,
			installSkill: null,
		};
		const stateFile = join(root, "state", "session.json");
		mkdirSync(join(root, "state"), { recursive: true });
		writeFileSync(stateFile, "{}", "utf8");

		await handleControlFrame(harness, {
			type: "reset",
			value: { persona: "Be brief." },
		});

		expect(readFileSync(join(root, "SOUL.md"), "utf8")).toBe("Be brief.");
		expect(() => readFileSync(stateFile, "utf8")).toThrow();
	});

	it("installs skills under skillsDir", async () => {
		const root = mkdtempSync(join(tmpdir(), "sumeru-session-skill-"));
		tempDirs.push(root);
		const harness = {
			resetPaths: [],
			modelConfigPath: null,
			personaPath: null,
			skillsDir: join(root, "skills"),
			writeModelConfig: null,
			installSkill: null,
		};

		await handleControlFrame(harness, {
			type: "install-skill",
			value: {
				name: "tdd",
				content: "Write tests first.",
				files: [{ path: "refs/guide.md", content: "Guide body" }],
			},
		});

		expect(readFileSync(join(root, "skills", "tdd", "SKILL.md"), "utf8")).toBe(
			"Write tests first.",
		);
		expect(
			readFileSync(join(root, "skills", "tdd", "refs", "guide.md"), "utf8"),
		).toBe("Guide body");
	});
});

describe("handleControlFrame — codex paths", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	function makeCodexHarness(root: string) {
		return {
			resetPaths: [join(root, "sessions")],
			modelConfigPath: join(root, "config.toml"),
			personaPath: join(root, "instructions.md"),
			skillsDir: join(root, "skills"),
			writeModelConfig: async (value: {
				baseUrl: string;
				apiKey: string | null;
				model: string;
				provider: string | null;
			}) => {
				mkdirSync(root, { recursive: true });
				writeFileSync(
					join(root, "config.toml"),
					formatCodexModelConfig(value),
					"utf8",
				);
			},
			installSkill: null,
		};
	}

	it("clears sessions and writes instructions.md on reset", async () => {
		const root = mkdtempSync(join(tmpdir(), "sumeru-session-codex-reset-"));
		tempDirs.push(root);
		const harness = makeCodexHarness(root);
		const sessionFile = join(root, "sessions", "thread.json");
		mkdirSync(join(root, "sessions"), { recursive: true });
		writeFileSync(sessionFile, "{}", "utf8");
		writeFileSync(join(root, "config.toml"), 'model = "old"\n', "utf8");

		await handleControlFrame(harness, {
			type: "reset",
			value: { persona: "You are Codex." },
		});

		expect(readFileSync(join(root, "instructions.md"), "utf8")).toBe(
			"You are Codex.",
		);
		expect(() => readFileSync(sessionFile, "utf8")).toThrow();
		expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(
			'model = "old"\n',
		);
	});

	it("writes TOML model config with bridge provider defaults", async () => {
		const root = mkdtempSync(join(tmpdir(), "sumeru-session-codex-model-"));
		tempDirs.push(root);
		const harness = makeCodexHarness(root);

		await handleControlFrame(harness, {
			type: "model",
			value: {
				baseUrl: "http://127.0.0.1:4142/v1",
				apiKey: "sk-test",
				model: "claude-sonnet-4.6",
				provider: "bridge",
			},
		});

		expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(
			formatCodexModelConfig({
				baseUrl: "http://127.0.0.1:4142/v1",
				apiKey: "sk-test",
				model: "claude-sonnet-4.6",
				provider: "bridge",
			}),
		);
	});

	it("installs skills under .codex/skills/<name>/SKILL.md", async () => {
		const root = mkdtempSync(join(tmpdir(), "sumeru-session-codex-skill-"));
		tempDirs.push(root);
		const harness = makeCodexHarness(root);

		await handleControlFrame(harness, {
			type: "install-skill",
			value: {
				name: "tdd",
				content: "Write tests first.",
				files: [{ path: "refs/guide.md", content: "Guide body" }],
			},
		});

		expect(readFileSync(join(root, "skills", "tdd", "SKILL.md"), "utf8")).toBe(
			"Write tests first.",
		);
		expect(
			readFileSync(join(root, "skills", "tdd", "refs", "guide.md"), "utf8"),
		).toBe("Guide body");
	});
});

describe("runSessionEntry", () => {
	it("responds with ready for sarsapa control frames", async () => {
		const stdin = new PassThrough();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const runPromise = runSessionEntry({
			kind: "sarsapa",
			impl: makeStubAdapter(),
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${JSON.stringify({ type: "reset", value: {} })}\n`);
		stdin.write(
			`${JSON.stringify({
				type: "model",
				value: {
					baseUrl: "https://example.test",
					apiKey: null,
					model: "demo",
				},
			})}\n`,
		);
		stdin.end();
		await runPromise;
		await flush();

		expect(stdout.frames()).toEqual([
			{ type: "ready", value: {} },
			{ type: "ready", value: {} },
		]);
	});

	it("handles control frames before init and still accepts init", async () => {
		const stdin = new PassThrough();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const runPromise = runSessionEntry({
			kind: "sarsapa",
			impl: makeStubAdapter(),
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(`${JSON.stringify({ type: "reset", value: {} })}\n`);
		stdin.write(
			`${JSON.stringify({
				type: "init",
				value: {
					instructions: "hello",
					skills: [],
					model: {
						name: "demo",
						apiKey: null,
						provider: "openai",
					},
				},
			})}\n`,
		);
		stdin.end();
		await runPromise;
		await flush();

		expect(stdout.frames()).toEqual([
			{ type: "ready", value: {} },
			{ type: "ready", value: {} },
		]);
	});

	it("does not forward control frames to the adapter impl", async () => {
		let initCalls = 0;
		const impl: AdapterImpl = {
			async init() {
				initCalls += 1;
			},
			async *handle(): AsyncGenerator<TurnValue, DoneValue> {
				if (false as boolean) {
					yield {
						index: 0,
						role: "assistant",
						content: "",
						timestamp: "",
						toolCalls: null,
						tokens: null,
					};
				}
				return { summary: "ok", tokenUsage: null };
			},
		};
		const stdin = new PassThrough();
		const stdout = makeStdout();
		const sigterm = makeSigtermHook();
		const runPromise = runSessionEntry({
			kind: "sarsapa",
			impl,
			stdin,
			stdout: stdout.stream,
			onSigterm: sigterm.hook,
		});

		stdin.write(
			`${JSON.stringify({ type: "install-skill", value: { name: "tdd", content: "x", files: [] } })}\n`,
		);
		stdin.end();
		await runPromise;

		expect(initCalls).toBe(0);
		expect(stdout.frames()[0]).toEqual({ type: "ready", value: {} });
	});
});

describe("getHarnessConfig", () => {
	it("returns sarsapa no-op paths", () => {
		expect(getHarnessConfig("sarsapa")).toEqual(sarsapaHarness);
	});

	it("returns codex harness with TOML writer and session reset path", () => {
		expect(getHarnessConfig("codex")).toEqual(codexHarness);
		expect(getHarnessConfig("codex").writeModelConfig).not.toBeNull();
		expect(getHarnessConfig("codex").resetPaths).toEqual(
			codexHarness.resetPaths,
		);
		expect(getHarnessConfig("codex").personaPath).toBe(
			codexHarness.personaPath,
		);
		expect(getHarnessConfig("codex").modelConfigPath).toBe(
			codexHarness.modelConfigPath,
		);
	});
});
