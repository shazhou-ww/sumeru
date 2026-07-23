import { mkdtempSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createAcpClient } from "../src/acp-client.js";
import { buildHermesConfig, createHermesAdapter } from "../src/adapter.js";
import type {
	AcpClient,
	AcpClientFactory,
	AcpProcess,
	AcpSessionUpdate,
} from "../src/types.js";

const INIT_CONFIG: AdapterInitConfig = {
	instructions: "You are the master agent.",
	skills: [{ name: "demo", content: "demo skill body" }],
	model: {
		provider: "anthropic",
		name: "claude-sonnet-4",
		apiKey: "test-key",
		contextWindow: 200_000,
	},
};

type MockServerOptions = {
	sessionId: string;
	onPrompt: (content: string, emit: (update: AcpSessionUpdate) => void) => void;
	// When set, session/resume responds with the nested _meta.hermes.sessionProvenance
	// shape instead of a top-level sessionId (real hermes behavior, #279).
	resumeNestedSessionId?: string;
};

// Drive an adapter `handle()` generator to completion, collecting the emitted
// turn frames (skipping suspend/control frames) and the final tokenUsage.
async function drainTurns(
	generator: AsyncGenerator<unknown, { tokenUsage: unknown }>,
): Promise<{ turns: Array<Record<string, unknown>>; tokenUsage: unknown }> {
	const turns: Array<Record<string, unknown>> = [];
	let tokenUsage: unknown = null;
	while (true) {
		const step = await generator.next();
		if (step.done === true) {
			tokenUsage = step.value.tokenUsage;
			break;
		}
		if (
			typeof step.value === "object" &&
			step.value !== null &&
			"type" in step.value
		) {
			continue;
		}
		turns.push(step.value as Record<string, unknown>);
	}
	return { turns, tokenUsage };
}

function createMockAcpProcess(options: MockServerOptions): AcpProcess {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let buffer = "";

	stdin.on("data", (chunk) => {
		buffer += chunk.toString();
		let newlineIdx = buffer.indexOf("\n");
		while (newlineIdx >= 0) {
			const line = buffer.slice(0, newlineIdx).trim();
			buffer = buffer.slice(newlineIdx + 1);
			if (line.length > 0) {
				handleRequest(line);
			}
			newlineIdx = buffer.indexOf("\n");
		}
	});

	function writeResponse(id: number, result: Record<string, unknown>): void {
		stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
	}

	function writeNotification(update: AcpSessionUpdate): void {
		stdout.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				method: "session/update",
				params: { sessionId: options.sessionId, update },
			})}\n`,
		);
	}

	function handleRequest(line: string): void {
		const parsed = JSON.parse(line) as {
			id: number;
			method: string;
			params: Record<string, unknown>;
		};
		if (parsed.method === "initialize") {
			writeResponse(parsed.id, { capabilities: {} });
			return;
		}
		if (parsed.method === "session/new") {
			writeResponse(parsed.id, { sessionId: options.sessionId });
			return;
		}
		if (parsed.method === "session/resume") {
			if (typeof options.resumeNestedSessionId === "string") {
				writeResponse(parsed.id, {
					_meta: {
						hermes: {
							sessionProvenance: {
								acpSessionId: options.resumeNestedSessionId,
							},
						},
					},
					models: {},
					modes: {},
				});
			} else {
				writeResponse(parsed.id, { sessionId: options.sessionId });
			}
			return;
		}
		if (parsed.method === "session/set_mode") {
			writeResponse(parsed.id, {});
			return;
		}
		if (parsed.method === "session/prompt") {
			const promptBlocks = parsed.params.prompt;
			const text =
				Array.isArray(promptBlocks) &&
				promptBlocks[0] !== undefined &&
				typeof promptBlocks[0] === "object" &&
				promptBlocks[0] !== null &&
				"text" in promptBlocks[0] &&
				typeof promptBlocks[0].text === "string"
					? promptBlocks[0].text
					: "";
			options.onPrompt(text, writeNotification);
			writeResponse(parsed.id, { stopReason: "end_turn" });
		}
	}

	return {
		stdin,
		stdout,
		kill: () => {
			stdin.destroy();
			stdout.destroy();
		},
		on: () => {},
	};
}

function createRecordingAcpClientFactory(
	options: MockServerOptions,
): AcpClientFactory {
	const calls: Array<{ method: string; args: Array<unknown> }> = [];
	const factory: AcpClientFactory & {
		calls: Array<{ method: string; args: Array<unknown> }>;
	} = (createOptions) => {
		const client = createAcpClient({
			...createOptions,
			clientInfo: { name: "sumeru-adapter", version: "0.1.0" },
			spawnProcess: () => createMockAcpProcess(options),
		});
		return wrapClientWithCallLog(client, calls);
	};
	factory.calls = calls;
	return factory;
}

function wrapClientWithCallLog(
	client: AcpClient,
	calls: Array<{ method: string; args: Array<unknown> }>,
): AcpClient {
	return {
		async initialize() {
			calls.push({ method: "initialize", args: [] });
			return client.initialize();
		},
		async newSession(cwd: string) {
			calls.push({ method: "newSession", args: [cwd] });
			return client.newSession(cwd);
		},
		async resumeSession(sessionId: string, cwd: string) {
			calls.push({ method: "resumeSession", args: [sessionId, cwd] });
			return client.resumeSession(sessionId, cwd);
		},
		async setMode(sessionId: string, modeId: string) {
			calls.push({ method: "setMode", args: [sessionId, modeId] });
			return client.setMode(sessionId, modeId);
		},
		async prompt(sessionId, content, onUpdate) {
			calls.push({ method: "prompt", args: [sessionId, content] });
			return client.prompt(sessionId, content, onUpdate);
		},
		async close() {
			calls.push({ method: "close", args: [] });
			return client.close();
		},
	};
}

describe("@sumeru/adapter-hermes — buildHermesConfig", () => {
	it("builds config for a known provider with apiKey", () => {
		expect(
			buildHermesConfig({
				provider: "anthropic",
				name: "claude-sonnet-4",
				apiKey: "test-key",
			}),
		).toBe(
			[
				"model:",
				"  provider: anthropic",
				"  default: claude-sonnet-4",
				"  api_key: test-key",
				"",
			].join("\n"),
		);
	});

	it("omits api_key for a known provider when apiKey is null", () => {
		expect(
			buildHermesConfig({
				provider: "openrouter",
				name: "anthropic/claude-sonnet-4",
				apiKey: null,
			}),
		).toBe(
			[
				"model:",
				"  provider: openrouter",
				"  default: anthropic/claude-sonnet-4",
				"",
			].join("\n"),
		);
	});

	it("builds config for a custom provider", () => {
		expect(
			buildHermesConfig({
				provider: {
					name: "local-llm",
					endpoint: "http://localhost:8080/v1",
					apiType: "openai",
				},
				name: "gpt-4o-mini",
				apiKey: "local-key",
			}),
		).toBe(
			[
				"custom_providers:",
				"  - name: local-llm",
				'    base_url: "http://localhost:8080/v1"',
				"    api_mode: chat_completions",
				"    api_key: local-key",
				"model:",
				"  provider: custom:local-llm",
				"  default: gpt-4o-mini",
				"",
			].join("\n"),
		);
	});

	it("auto-appends /v1 to custom provider endpoint when missing", () => {
		expect(
			buildHermesConfig({
				provider: {
					name: "proxy",
					endpoint: "http://host.docker.internal:4141",
					apiType: "anthropic",
				},
				name: "claude-opus-4.6",
				apiKey: "sk-test",
			}),
		).toBe(
			[
				"custom_providers:",
				"  - name: proxy",
				'    base_url: "http://host.docker.internal:4141/v1"',
				"    api_mode: chat_completions",
				"    api_key: sk-test",
				"model:",
				"  provider: custom:proxy",
				"  default: claude-opus-4.6",
				"",
			].join("\n"),
		);
	});

	it("throws on invalid custom provider endpoint (relative path)", () => {
		expect(() =>
			buildHermesConfig({
				provider: {
					name: "broken",
					endpoint: "/v1",
					apiType: "openai",
				},
				name: "auto",
				apiKey: null,
			}),
		).toThrow(/invalid endpoint/i);
	});

	it("throws on empty custom provider endpoint", () => {
		expect(() =>
			buildHermesConfig({
				provider: {
					name: "broken",
					endpoint: "",
					apiType: "openai",
				},
				name: "auto",
				apiKey: null,
			}),
		).toThrow(/invalid endpoint/i);
	});
});

describe("@sumeru/adapter-hermes — adapter", () => {
	it("init writes SOUL.md, skills, and config.yaml under the configured hermes dir", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-init-"));
		const adapter = createHermesAdapter({ profile: "test", hermesDir });
		await adapter.init(INIT_CONFIG);

		const soul = await readFile(join(hermesDir, "SOUL.md"), "utf-8");
		expect(soul).toBe(INIT_CONFIG.instructions);
		const skill = await readFile(
			join(hermesDir, "skills", "demo", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("demo skill body");
		const configYaml = await readFile(join(hermesDir, "config.yaml"), "utf-8");
		expect(configYaml).toBe(buildHermesConfig(INIT_CONFIG.model));
	});

	it("handle uses ACP prompt and yields streaming assistant turns", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-handle-"));
		await mkdir(hermesDir, { recursive: true });
		const nativeId = "20260627_120000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (content, emit) => {
				expect(content).toBe("ping");
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "hello from hermes" },
				});
				emit({
					sessionUpdate: "usage_update",
					input_tokens: 10,
					output_tokens: 5,
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_1",
			content: "ping",
			project: "/tmp/project",
		});
		const turns = [];
		let tokenUsage = null;
		while (true) {
			const step = await generator.next();
			if (step.done === true) {
				tokenUsage = step.value.tokenUsage;
				break;
			}
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(acpClientFactory.calls.map((call) => call.method)).toEqual([
			"initialize",
			"newSession",
			"setMode",
			"prompt",
		]);
		expect(acpClientFactory.calls[1]?.args[0]).toBe("/tmp/project");
		expect(turns).toHaveLength(1);
		expect(turns[0]?.content).toBe("hello from hermes");
		expect(turns[0]?.toolCalls).toBeNull();
		expect(tokenUsage).toEqual({ input: 10, output: 5, cached: 0 });
		expect(adapter.getNativeId?.()).toBe(nativeId);
	});

	it("attaches usage_update tokens to the flushed turn frame (bug #178)", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-turn-tokens-"));
		await mkdir(hermesDir, { recursive: true });
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: "20260630_021918_aaaa11",
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "pong" },
				});
				emit({
					sessionUpdate: "usage_update",
					input_tokens: 100,
					output_tokens: 20,
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_tokens",
			content: "ping",
			project: null,
		});
		const turns = [];
		while (true) {
			const step = await generator.next();
			if (step.done === true) break;
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(turns).toHaveLength(1);
		expect(turns[0]?.content).toBe("pong");
		// The turn frame must carry the per-turn token usage, not null.
		expect(turns[0]?.tokens).toEqual({ input: 100, output: 20, cached: 0 });
	});

	it("leaves tokens null on a turn that never saw a usage_update (bug #178)", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-turn-no-tokens-"));
		await mkdir(hermesDir, { recursive: true });
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: "20260630_021918_bbbb22",
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "pong" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_no_tokens",
			content: "ping",
			project: null,
		});
		const turns = [];
		while (true) {
			const step = await generator.next();
			if (step.done === true) break;
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(turns).toHaveLength(1);
		expect(turns[0]?.tokens).toBeNull();
	});

	it("does not double-count usage across multiple flushed turns (bug #178)", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-turn-tokens-multi-"));
		await mkdir(hermesDir, { recursive: true });
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: "20260630_021918_cccc33",
			onPrompt: (_content, emit) => {
				// First assistant turn with its own usage.
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "first" },
				});
				emit({
					sessionUpdate: "usage_update",
					input_tokens: 100,
					output_tokens: 20,
				});
				// A tool_call flushes the accumulated text as turn #0.
				emit({
					sessionUpdate: "tool_call",
					toolCallId: "tc_1",
					name: "terminal",
					input: { command: "ls" },
				});
				// Second assistant turn — no further usage_update.
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "second" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_multi",
			content: "ping",
			project: null,
		});
		const turns = [];
		while (true) {
			const step = await generator.next();
			if (step.done === true) break;
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(turns).toHaveLength(2);
		// The usage belongs to the first flushed turn only.
		expect(turns[0]?.content).toBe("first");
		expect(turns[0]?.tokens).toEqual({ input: 100, output: 20, cached: 0 });
		// The second turn must not re-claim the same usage.
		expect(turns[1]?.content).toBe("second");
		expect(turns[1]?.tokens).toBeNull();
	});

	it("reuses the long-lived ACP client across subsequent handle calls", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-reuse-"));
		const nativeId = "20260627_130000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "ok" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		for (let i = 0; i < 2; i += 1) {
			const generator = adapter.handle({
				messageId: `msg_${i}`,
				content: `ping-${i}`,
				project: null,
			});
			while (true) {
				const step = await generator.next();
				if (step.done === true) break;
			}
		}

		expect(acpClientFactory.calls.map((call) => call.method)).toEqual([
			"initialize",
			"newSession",
			"setMode",
			"prompt",
			"prompt",
		]);
	});

	// Scenario 1 + 2 + 3 + 4: the full progressive sequence (#182).
	it("emits progressive turns: assistant(toolCalls) → tool → assistant", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-progressive-"));
		const nativeId = "20260627_150000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "让我查看一下..." },
				});
				emit({
					sessionUpdate: "tool_call",
					toolCallId: "tc_1",
					name: "terminal",
					input: { command: "ls /tmp" },
				});
				emit({
					sessionUpdate: "tool_result",
					toolCallId: "tc_1",
					result: "file1.txt file2.txt",
					durationMs: 150,
				});
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "目录下有 file1.txt 和 file2.txt" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const { turns } = await drainTurns(
			adapter.handle({
				messageId: "msg_tools",
				content: "list files",
				project: null,
			}),
		);

		// Scenario 4: exactly three turns, in order, not collapsed into one.
		expect(turns).toHaveLength(3);

		// Scenario 1: the triggering text is bound to the SAME frame as the call.
		expect(turns[0]?.role).toBe("assistant");
		expect(turns[0]?.content).toBe("让我查看一下...");
		expect(turns[0]?.toolCalls).toEqual([
			{
				id: "tc_1",
				tool: "terminal",
				input: { command: "ls /tmp" },
				output: null,
				durationMs: null,
				exitCode: null,
			},
		]);
		expect(turns[0]?.index).toBe(0);

		// Scenario 2: an independent role:"tool" turn for the tool_result.
		expect(turns[1]).toEqual({
			index: 1,
			role: "tool",
			name: "terminal",
			callId: "tc_1",
			result: "file1.txt file2.txt",
			durationMs: 150,
			timestamp: expect.any(String),
		});

		// Scenario 3: trailing text flushed as the final assistant turn.
		expect(turns[2]?.role).toBe("assistant");
		expect(turns[2]?.content).toBe("目录下有 file1.txt 和 file2.txt");
		expect(turns[2]?.toolCalls).toBeNull();
		expect(turns[2]?.index).toBe(2);
	});

	// Scenario 1: tool_call flushes prior text bound WITH the tool call (not null).
	it("binds pending text and the tool call into one assistant frame on tool_call", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-toolcall-flush-"));
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: "20260627_150100_abcd12",
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "让我查看一下..." },
				});
				emit({
					sessionUpdate: "tool_call",
					toolCallId: "tc_1",
					name: "terminal",
					input: { command: "ls /tmp" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const { turns } = await drainTurns(
			adapter.handle({ messageId: "m", content: "go", project: null }),
		);

		const assistant = turns.find((t) => t.role === "assistant");
		expect(assistant?.content).toBe("让我查看一下...");
		// The call must be bound here, NOT deferred to a later assistant turn.
		expect(assistant?.toolCalls).not.toBeNull();
		expect((assistant?.toolCalls as Array<unknown>).length).toBe(1);
	});

	// Scenario 5: two tool rounds in one handle, each assistant carries only its
	// own round's call (no cross-talk), each tool turn follows its assistant.
	it("emits each loop round independently for multi-round tool use", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-multiround-"));
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: "20260627_150200_abcd12",
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "text_a" },
				});
				emit({
					sessionUpdate: "tool_call",
					toolCallId: "A",
					name: "toolA",
					input: { n: 1 },
				});
				emit({
					sessionUpdate: "tool_result",
					toolCallId: "A",
					result: "resA",
					durationMs: 10,
				});
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "text_b" },
				});
				emit({
					sessionUpdate: "tool_call",
					toolCallId: "B",
					name: "toolB",
					input: { n: 2 },
				});
				emit({
					sessionUpdate: "tool_result",
					toolCallId: "B",
					result: "resB",
					durationMs: 20,
				});
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "text_c" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const { turns } = await drainTurns(
			adapter.handle({ messageId: "m", content: "go", project: null }),
		);

		expect(turns).toHaveLength(5);
		expect(turns[0]?.content).toBe("text_a");
		expect((turns[0]?.toolCalls as Array<{ tool: string }>)[0]?.tool).toBe(
			"toolA",
		);
		expect(turns[1]).toMatchObject({
			role: "tool",
			name: "toolA",
			callId: "A",
		});
		expect(turns[2]?.content).toBe("text_b");
		expect((turns[2]?.toolCalls as Array<{ tool: string }>)[0]?.tool).toBe(
			"toolB",
		);
		expect(turns[3]).toMatchObject({
			role: "tool",
			name: "toolB",
			callId: "B",
		});
		expect(turns[4]?.content).toBe("text_c");
		expect(turns[4]?.toolCalls).toBeNull();
		// Indices are monotonically increasing across the whole loop.
		expect(turns.map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
	});

	// Scenario 6: pure-text reply must not regress to multiple/zero turns.
	it("still emits exactly one assistant turn for a pure-text reply (#178 no-regress)", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-puretext-"));
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: "20260627_150300_abcd12",
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "pong" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const { turns } = await drainTurns(
			adapter.handle({ messageId: "m", content: "ping", project: null }),
		);

		expect(turns).toHaveLength(1);
		expect(turns[0]?.role).toBe("assistant");
		expect(turns[0]?.content).toBe("pong");
		expect(turns[0]?.toolCalls).toBeNull();
	});

	it("resume() returns false when no persisted state exists", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-resume-missing-"));
		const homeDir = mkdtempSync(join(tmpdir(), "hermes-resume-home-"));
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
		});
		expect(await adapter.resume?.()).toBe(false);
	});

	it("persists session id after first handle and resume() restores it", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-resume-persist-"));
		const homeDir = mkdtempSync(join(tmpdir(), "hermes-resume-home-"));
		const nativeId = "20260627_160000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "ok" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_1",
			content: "ping",
			project: null,
		});
		while (true) {
			const step = await generator.next();
			if (step.done === true) break;
		}
		expect(adapter.getNativeId?.()).toBe(nativeId);

		const persisted = JSON.parse(
			await readFile(join(homeDir, ".hermes-adapter", "session.json"), "utf-8"),
		) as { sessionId: string; initConfig: AdapterInitConfig };
		expect(persisted.sessionId).toBe(nativeId);
		expect(persisted.initConfig.instructions).toBe(INIT_CONFIG.instructions);

		const resumed = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
			acpClientFactory,
		});
		expect(await resumed.resume?.()).toBe(true);
		expect(resumed.getNativeId?.()).toBe(nativeId);

		const soul = await readFile(join(hermesDir, "SOUL.md"), "utf-8");
		expect(soul).toBe(INIT_CONFIG.instructions);
	});

	it("uses ACP session/resume on handle after resume()", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-resume-handle-"));
		const homeDir = mkdtempSync(join(tmpdir(), "hermes-resume-home-"));
		const nativeId = "20260627_170000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "ok" },
				});
			},
		});
		const first = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
			acpClientFactory,
		});
		await first.init(INIT_CONFIG);
		const firstGen = first.handle({
			messageId: "msg_1",
			content: "ping",
			project: null,
		});
		while (true) {
			const step = await firstGen.next();
			if (step.done === true) break;
		}

		const second = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
			acpClientFactory,
		});
		expect(await second.resume?.()).toBe(true);

		const secondGen = second.handle({
			messageId: "msg_2",
			content: "pong",
			project: null,
		});
		while (true) {
			const step = await secondGen.next();
			if (step.done === true) break;
		}

		expect(acpClientFactory.calls.map((call) => call.method)).toEqual([
			"initialize",
			"newSession",
			"setMode",
			"prompt",
			"initialize",
			"resumeSession",
			"setMode",
			"prompt",
		]);
		expect(acpClientFactory.calls[5]?.args[0]).toBe(nativeId);
		// Regression #277: session/resume must carry the cwd param.
		expect(acpClientFactory.calls[5]?.args[1]).toBe(process.cwd());
	});

	it("resumeSession receives the message cwd param (#277)", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-resume-cwd-"));
		const homeDir = mkdtempSync(join(tmpdir(), "hermes-resume-cwd-home-"));
		const nativeId = "20260627_180000_abcd12";
		const projectCwd = "/tmp/project-277";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "ok" },
				});
			},
		});
		const first = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
			acpClientFactory,
		});
		await first.init(INIT_CONFIG);
		const firstGen = first.handle({
			messageId: "msg_1",
			content: "ping",
			project: projectCwd,
		});
		while (true) {
			const step = await firstGen.next();
			if (step.done === true) break;
		}

		const second = createHermesAdapter({
			profile: "test",
			hermesDir,
			homeDir,
			acpClientFactory,
		});
		expect(await second.resume?.()).toBe(true);

		const secondGen = second.handle({
			messageId: "msg_2",
			content: "pong",
			project: projectCwd,
		});
		while (true) {
			const step = await secondGen.next();
			if (step.done === true) break;
		}

		const resumeCall = acpClientFactory.calls.find(
			(call) => call.method === "resumeSession",
		);
		expect(resumeCall).toBeDefined();
		expect(resumeCall?.args[0]).toBe(nativeId);
		expect(resumeCall?.args[1]).toBe(projectCwd);
	});
});

describe("@sumeru/adapter-hermes — acp-client", () => {
	it("dispatches JSON-RPC responses and session_update notifications", async () => {
		const sessionId = "sess_mock_1";
		const client = createAcpClient({
			command: "hermes",
			args: ["acp", "--accept-hooks"],
			cwd: process.cwd(),
			clientInfo: { name: "test-client", version: "0.0.1" },
			spawnProcess: () =>
				createMockAcpProcess({
					sessionId,
					onPrompt: (_content, emit) => {
						emit({
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "streamed" },
						});
					},
				}),
		});

		await client.initialize();
		const created = await client.newSession(process.cwd());
		expect(created.sessionId).toBe(sessionId);

		const updates: Array<AcpSessionUpdate> = [];
		const result = await client.prompt(sessionId, "hello", (update) => {
			updates.push(update);
		});
		expect(result).toEqual({ stopReason: "end_turn" });
		expect(updates).toEqual([
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "streamed" },
			},
		]);
	});

	it("parses tool_result session updates (#182)", async () => {
		const sessionId = "sess_mock_tool_result";
		const client = createAcpClient({
			command: "hermes",
			args: ["acp", "--accept-hooks"],
			cwd: process.cwd(),
			clientInfo: { name: "test-client", version: "0.0.1" },
			spawnProcess: () =>
				createMockAcpProcess({
					sessionId,
					onPrompt: (_content, emit) => {
						emit({
							sessionUpdate: "tool_call",
							toolCallId: "tc_1",
							name: "terminal",
							input: { command: "ls" },
						});
						emit({
							sessionUpdate: "tool_result",
							toolCallId: "tc_1",
							result: "file1.txt",
							durationMs: 42,
						});
					},
				}),
		});

		await client.initialize();
		await client.newSession(process.cwd());

		const updates: Array<AcpSessionUpdate> = [];
		await client.prompt(sessionId, "hello", (update) => {
			updates.push(update);
		});

		expect(updates).toContainEqual({
			sessionUpdate: "tool_result",
			toolCallId: "tc_1",
			result: "file1.txt",
			durationMs: 42,
		});
	});

	it("resumeSession extracts sessionId from _meta.hermes.sessionProvenance (#279)", async () => {
		const resumedSessionId = "d2c9e661-resume-279";
		const client = createAcpClient({
			command: "hermes",
			args: ["acp", "--accept-hooks"],
			cwd: process.cwd(),
			clientInfo: { name: "test-client", version: "0.0.1" },
			spawnProcess: () =>
				createMockAcpProcess({
					sessionId: resumedSessionId,
					resumeNestedSessionId: resumedSessionId,
					onPrompt: (_content, emit) => {
						emit({
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "resumed" },
						});
					},
				}),
		});

		await client.initialize();
		// The mock server responds to session/resume with NO top-level sessionId,
		// only _meta.hermes.sessionProvenance.acpSessionId — the real hermes shape.
		const result = await client.resumeSession(resumedSessionId, process.cwd());
		expect(result.sessionId).toBe(resumedSessionId);
	});
});
