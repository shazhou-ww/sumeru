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
import { afterEach, describe, expect, it } from "vitest";
import type {
	AdapterImpl,
	AdapterManifest,
	DoneValue,
	HarnessConfig,
	TurnValue,
} from "../src/index.js";
import { runSubcommand } from "../src/subcommand.js";

type StdoutCapture = {
	stream: NodeJS.WritableStream;
	text(): string;
	lines(): Array<unknown>;
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
		text: () => buffer,
		lines: () =>
			buffer
				.split("\n")
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as unknown),
	};
}

function makeStdin(line: string | null = null): PassThrough {
	const stdin = new PassThrough();
	if (line !== null) {
		stdin.write(`${line}\n`);
		stdin.end();
	} else {
		stdin.end();
	}
	return stdin;
}

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

const defaultIo = {
	env: null as NodeJS.ProcessEnv | null,
	sendTimeoutMs: null as number | null,
};

function makeStubAdapter(overrides: Partial<AdapterImpl> = {}): AdapterImpl {
	return {
		async init() {},
		async *handle(): AsyncGenerator<TurnValue, DoneValue> {
			if (false as boolean) {
				yield turn(0, "");
			}
			return { summary: "ok", tokenUsage: null };
		},
		...overrides,
	};
}

const manifest: AdapterManifest = {
	name: "test-adapter",
	providerMode: "custom-only",
	credentialEnv: null,
	listModels: null,
};

const tempDirs: Array<string> = [];

function makeTempHarness(): { harness: HarnessConfig; root: string } {
	const root = mkdtempSync(join(tmpdir(), "sumeru-subcommand-"));
	tempDirs.push(root);
	const harness: HarnessConfig = {
		resetPaths: [join(root, "state")],
		modelConfigPath: join(root, "model.json"),
		personaPath: join(root, "PERSONA.md"),
		skillsDir: join(root, "skills"),
		writeModelConfig: null,
		installSkill: null,
	};
	return { harness, root };
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("runSubcommand — info", () => {
	it("prints AdapterManifest JSON and exits 0", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "info"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([
			{
				name: manifest.name,
				providerMode: manifest.providerMode,
				credentialEnv: manifest.credentialEnv,
				listModels: null,
			},
		]);
	});
});

describe("runSubcommand — config", () => {
	it("writes model/persona/skills, calls init, exits 0", async () => {
		const { harness, root } = makeTempHarness();
		const stdout = makeStdout();
		let initCalled = false;
		const impl = makeStubAdapter({
			async init(config) {
				initCalled = true;
				expect(config.instructions).toBe("Be brief.");
			},
		});
		const config = {
			instructions: "Be brief.",
			skills: [{ name: "tdd", content: "# TDD\n" }],
			model: {
				provider: "anthropic" as const,
				name: "claude-sonnet-4",
				apiKey: "sk-test",
			},
		};
		const code = await runSubcommand({
			impl,
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "config"],
			stdin: makeStdin(JSON.stringify(config)),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([{ ok: true }]);
		expect(initCalled).toBe(true);
		expect(JSON.parse(readFileSync(join(root, "model.json"), "utf8"))).toEqual({
			baseUrl: "https://api.anthropic.com",
			apiKey: "sk-test",
			model: "claude-sonnet-4",
			provider: "anthropic",
		});
		expect(readFileSync(join(root, "PERSONA.md"), "utf8")).toBe("Be brief.");
		expect(readFileSync(join(root, "skills", "tdd", "SKILL.md"), "utf8")).toBe(
			"# TDD\n",
		);
	});

	it("exits 2 on invalid JSON input", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "config"],
			stdin: makeStdin("not-json"),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(2);
	});
});

describe("runSubcommand — reset", () => {
	it("clears resetPaths and exits 0", async () => {
		const { harness, root } = makeTempHarness();
		mkdirSync(join(root, "state"), { recursive: true });
		writeFileSync(join(root, "state", "session.json"), "{}");
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "reset"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([{ ok: true }]);
		expect(() => readFileSync(join(root, "state", "session.json"))).toThrow();
	});
});

describe("runSubcommand — message", () => {
	it("streams turn/done frames and exits 0", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const impl = makeStubAdapter({
			async *handle(message) {
				yield turn(0, `re: ${message.content}`);
				return { summary: "ok", tokenUsage: null };
			},
		});
		const code = await runSubcommand({
			impl,
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "message"],
			stdin: makeStdin(
				JSON.stringify({
					messageId: "msg_01",
					content: "hello",
					project: null,
				}),
			),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([
			{ type: "turn", value: turn(0, "re: hello") },
			{ type: "done", value: { summary: "ok", tokenUsage: null } },
		]);
	});

	it("calls resume before handle", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const order: Array<string> = [];
		const impl = makeStubAdapter({
			async resume() {
				order.push("resume");
				return true;
			},
			// biome-ignore lint/correctness/useYield: exercise resume-before-handle order only
			async *handle() {
				order.push("handle");
				return { summary: null, tokenUsage: null };
			},
		});
		await runSubcommand({
			impl,
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "message"],
			stdin: makeStdin(
				JSON.stringify({
					messageId: "msg_01",
					content: "hi",
					project: null,
				}),
			),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(order).toEqual(["resume", "handle"]);
	});

	it("exits 3 on suspend", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const impl = makeStubAdapter({
			async *handle() {
				yield {
					type: "suspend" as const,
					value: { reason: "inputRequired" as const, elapsedMs: 12 },
				};
				return { summary: null, tokenUsage: null };
			},
			getNativeId: () => "native-1",
		});
		const code = await runSubcommand({
			impl,
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "message"],
			stdin: makeStdin(
				JSON.stringify({
					messageId: "msg_01",
					content: "hi",
					project: null,
				}),
			),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(3);
		expect(stdout.lines()[0]).toEqual({
			type: "suspend",
			value: {
				reason: "inputRequired",
				elapsedMs: 12,
				nativeId: "native-1",
			},
		});
	});

	it("exits 2 on invalid message input", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "message"],
			stdin: makeStdin(JSON.stringify({ content: "missing-id" })),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(2);
	});

	it("exits 1 and writes error frame on handler throw", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const impl = makeStubAdapter({
			// biome-ignore lint/correctness/useYield: exercise handler error path only
			async *handle() {
				throw new Error("boom");
			},
		});
		const code = await runSubcommand({
			impl,
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "message"],
			stdin: makeStdin(
				JSON.stringify({
					messageId: "msg_01",
					content: "hi",
					project: null,
				}),
			),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(1);
		expect(stdout.lines()[0]).toEqual({
			type: "error",
			value: { code: "handler_error", message: "boom" },
		});
	});
});

describe("runSubcommand — turns", () => {
	it("prints NDJSON turn values when getTurns is implemented", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const t0 = turn(0, "a");
		const t1 = turn(1, "b");
		const impl = makeStubAdapter({
			getTurns: () => [t0, t1],
		});
		const code = await runSubcommand({
			impl,
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "turns"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([t0, t1]);
	});

	it("prints [] when getTurns is not implemented", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "turns"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([[]]);
	});
});

describe("runSubcommand — install-skill / uninstall-skill", () => {
	it("install-skill --from copies skill dir and exits 0", async () => {
		const { harness, root } = makeTempHarness();
		const skillSrc = join(root, "src-skill");
		mkdirSync(skillSrc, { recursive: true });
		writeFileSync(
			join(skillSrc, "SKILL.md"),
			"---\nname: web-scraper\n---\n# Web Scraper\n",
		);
		writeFileSync(join(skillSrc, "helper.py"), "print(1)\n");
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "install-skill", "--from", skillSrc],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([{ ok: true }]);
		expect(
			readFileSync(join(root, "skills", "web-scraper", "SKILL.md"), "utf8"),
		).toContain("name: web-scraper");
		expect(
			readFileSync(join(root, "skills", "web-scraper", "helper.py"), "utf8"),
		).toBe("print(1)\n");
	});

	it("uninstall-skill removes skill dir and exits 0", async () => {
		const { harness, root } = makeTempHarness();
		mkdirSync(join(root, "skills", "tdd"), { recursive: true });
		writeFileSync(join(root, "skills", "tdd", "SKILL.md"), "# TDD\n");
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "uninstall-skill", "tdd"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([{ ok: true }]);
		expect(() =>
			readFileSync(join(root, "skills", "tdd", "SKILL.md")),
		).toThrow();
	});
});

describe("runSubcommand — list-models", () => {
	it("prints [] when listModels is null", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "list-models"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([[]]);
	});

	it("calls listModels with credential from env", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest: {
				name: "with-models",
				providerMode: "both",
				credentialEnv: "TEST_API_KEY",
				listModels: async (credential) => [
					{ id: "m1", name: `model-${credential}`, contextWindow: 100 },
				],
			},
			argv: ["node", "sumeru-adapter", "list-models"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			env: { TEST_API_KEY: "secret" },
			sendTimeoutMs: null,
		});
		expect(code).toBe(0);
		expect(stdout.lines()).toEqual([
			[{ id: "m1", name: "model-secret", contextWindow: 100 }],
		]);
	});
});

describe("runSubcommand — unknown", () => {
	it("exits 1 for unknown subcommand", async () => {
		const { harness } = makeTempHarness();
		const stdout = makeStdout();
		const code = await runSubcommand({
			impl: makeStubAdapter(),
			harness,
			manifest,
			argv: ["node", "sumeru-adapter", "nope"],
			stdin: makeStdin(),
			stdout: stdout.stream,
			...defaultIo,
		});
		expect(code).toBe(1);
	});
});
