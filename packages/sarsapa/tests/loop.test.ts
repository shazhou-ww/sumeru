import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInboxMessage, WireToolCall } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createSarsapaAdapter } from "../src/agent.js";
import type { SarsapaOptions, Tool } from "../src/types.js";

function testAdapterOptions(
	overrides: Partial<SarsapaOptions> = {},
): Partial<SarsapaOptions> {
	const dir = mkdtempSync(join(tmpdir(), "sarsapa-loop-"));
	return { sessionPath: join(dir, "session.jsonl"), ...overrides };
}

function mockFetch(): typeof fetch {
	let call = 0;
	return (async (_input: RequestInfo | URL, _init?: RequestInit) => {
		call += 1;
		const body =
			call === 1
				? {
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{
											id: "call_1",
											type: "function",
											function: {
												name: "terminal",
												arguments: '{"command":"echo hello"}',
											},
										},
									],
								},
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5 },
					}
				: {
						choices: [{ message: { content: "done" } }],
						usage: { prompt_tokens: 20, completion_tokens: 5 },
					};
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
}

describe("sarsapa loop", () => {
	it("runs a tool call then finishes with done", async () => {
		const adapter = createSarsapaAdapter(
			testAdapterOptions({
				fetchImpl: mockFetch(),
				maxIterations: 5,
			}),
		);
		await adapter.init({
			instructions: "you are a test agent",
			skills: [],
			model: {
				provider: "openai",
				name: "gpt-4.1",
				apiKey: "test-key",
				contextWindow: 8000,
			},
		});
		const msg: AdapterInboxMessage = {
			messageId: "msg_1",
			content: "echo hello",
			project: null,
		};
		const gen = adapter.handle(msg);
		const turns: unknown[] = [];
		let done: unknown;
		while (true) {
			const step = await gen.next();
			if (step.done === true) {
				done = step.value;
				break;
			}
			turns.push(step.value);
		}
		// first turn: assistant with a tool_call (terminal echo hello)
		// second turn: assistant final answer "done"
		expect(turns.length).toBe(2);
		const first = turns[0] as { toolCalls: WireToolCall[] };
		expect(Array.isArray(first.toolCalls)).toBe(true);
		// WireToolCall.id must be forwarded from LlmToolCall.id
		expect(first.toolCalls[0].id).toBe("call_1");
		expect(first.toolCalls[0].tool).toBe("terminal");
		expect(first.toolCalls[0].output).toBeDefined();
		expect(first.toolCalls[0].output).not.toBeNull();
		const doneValue = done as { tokenUsage: { input: number; output: number } };
		expect(doneValue.tokenUsage.input).toBe(30);
		expect(doneValue.tokenUsage.output).toBe(10);
	});
});

// --- Error resilience tests ---

function mockFetchWithToolCall(toolName: string, args: string): typeof fetch {
	let call = 0;
	return (async () => {
		call += 1;
		const body =
			call === 1
				? {
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{
											id: "call_err",
											type: "function",
											function: { name: toolName, arguments: args },
										},
									],
								},
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5 },
					}
				: {
						choices: [{ message: { content: "handled" } }],
						usage: { prompt_tokens: 10, completion_tokens: 5 },
					};
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
}

const INIT_CONFIG = {
	instructions: "test agent",
	skills: [],
	model: {
		provider: "openai" as const,
		name: "gpt-4.1",
		apiKey: "test-key",
		contextWindow: 8000,
	},
};

const MSG: AdapterInboxMessage = {
	messageId: "msg_e",
	content: "trigger",
	project: null,
};

async function collectTurns(adapter: ReturnType<typeof createSarsapaAdapter>) {
	const gen = adapter.handle(MSG);
	const turns: Array<{ toolCalls: WireToolCall[] | null }> = [];
	let done: unknown;
	while (true) {
		const step = await gen.next();
		if (step.done === true) {
			done = step.value;
			break;
		}
		turns.push(step.value as { toolCalls: WireToolCall[] | null });
	}
	return { turns, done };
}

describe("sarsapa loop — error resilience", () => {
	it("unknown tool: returns error output without crashing", async () => {
		// LLM calls "nonexistent_tool" but no such tool is registered
		const adapter = createSarsapaAdapter(
			testAdapterOptions({
				fetchImpl: mockFetchWithToolCall("nonexistent_tool", '{"x":1}'),
				maxIterations: 5,
				tools: [], // no tools registered
			}),
		);
		await adapter.init(INIT_CONFIG);
		const { turns, done } = await collectTurns(adapter);

		expect(turns.length).toBe(2);
		const tc = turns[0].toolCalls?.[0];
		expect(tc).toBeDefined();
		expect(tc?.id).toBe("call_err");
		expect(tc?.output).toContain("Error: unknown tool");
		expect(tc?.exitCode).toBeNull();
		expect(done).toBeDefined();
	});

	it("invalid JSON arguments: returns parse error without crashing", async () => {
		const dummyTool: Tool = {
			name: "dummy",
			description: "test",
			parameters: {},
			execute: async () => ({
				output: "ok",
				durationMs: 1,
				exitCode: 0,
			}),
		};
		const adapter = createSarsapaAdapter(
			testAdapterOptions({
				fetchImpl: mockFetchWithToolCall("dummy", "NOT_JSON{{{"),
				maxIterations: 5,
				tools: [dummyTool],
			}),
		);
		await adapter.init(INIT_CONFIG);
		const { turns, done } = await collectTurns(adapter);

		expect(turns.length).toBe(2);
		const tc = turns[0].toolCalls?.[0];
		expect(tc).toBeDefined();
		expect(tc?.id).toBe("call_err");
		expect(tc?.output).toContain("Error: arguments is not valid JSON");
		expect(tc?.exitCode).toBe(1);
		expect(done).toBeDefined();
	});

	it("tool throws: returns error output without crashing", async () => {
		const throwingTool: Tool = {
			name: "exploder",
			description: "always throws",
			parameters: {},
			execute: async () => {
				throw new Error("kaboom");
			},
		};
		const adapter = createSarsapaAdapter(
			testAdapterOptions({
				fetchImpl: mockFetchWithToolCall("exploder", "{}"),
				maxIterations: 5,
				tools: [throwingTool],
			}),
		);
		await adapter.init(INIT_CONFIG);
		const { turns, done } = await collectTurns(adapter);

		expect(turns.length).toBe(2);
		const tc = turns[0].toolCalls?.[0];
		expect(tc).toBeDefined();
		expect(tc?.id).toBe("call_err");
		expect(tc?.output).toContain("Error: tool 'exploder' threw");
		expect(tc?.output).toContain("kaboom");
		expect(tc?.exitCode).toBe(1);
		expect(tc?.durationMs).toBeGreaterThanOrEqual(0);
		expect(done).toBeDefined();
	});
});

// --- Multi-turn and skill injection tests ---

describe("sarsapa multi-turn", () => {
	it("preserves conversation history across multiple handle() calls", async () => {
		let call = 0;
		let lastBody: unknown = null;
		const fakeFetch: typeof fetch = (async (_input, init) => {
			call += 1;
			lastBody = JSON.parse((init?.body as string) ?? "{}");
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: `reply ${call}` } }],
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const adapter = createSarsapaAdapter(
			testAdapterOptions({ fetchImpl: fakeFetch }),
		);
		await adapter.init({
			instructions: "you are helpful",
			skills: [],
			model: {
				provider: "openai",
				name: "gpt-4.1",
				apiKey: "k",
				contextWindow: 8000,
			},
		});

		// First message
		const gen1 = adapter.handle({
			messageId: "m1",
			content: "hello",
			project: null,
		});
		const turns1: unknown[] = [];
		for await (const t of gen1) turns1.push(t);

		// Second message — should include history from first
		const gen2 = adapter.handle({
			messageId: "m2",
			content: "world",
			project: null,
		});
		const turns2: unknown[] = [];
		for await (const t of gen2) turns2.push(t);

		// The second LLM call should have 4 messages: system, user1, assistant1, user2
		const body = lastBody as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.messages.length).toBe(4);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[1]).toMatchObject({ role: "user", content: "hello" });
		expect(body.messages[2]).toMatchObject({
			role: "assistant",
			content: "reply 1",
		});
		expect(body.messages[3]).toMatchObject({ role: "user", content: "world" });
	});
});

describe("sarsapa skill injection", () => {
	it("includes skills in system prompt", async () => {
		let capturedBody: unknown = null;
		const fakeFetch: typeof fetch = (async (_input, init) => {
			capturedBody = JSON.parse((init?.body as string) ?? "{}");
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: "ok" } }],
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const adapter = createSarsapaAdapter(
			testAdapterOptions({ fetchImpl: fakeFetch }),
		);
		await adapter.init({
			instructions: "base instructions",
			skills: [
				{ name: "tdd", content: "Write tests first." },
				{ name: "git", content: "Use conventional commits." },
			],
			model: {
				provider: "openai",
				name: "gpt-4.1",
				apiKey: "k",
				contextWindow: 8000,
			},
		});

		const gen = adapter.handle({
			messageId: "m1",
			content: "hi",
			project: null,
		});
		for await (const _ of gen) {
			/* drain */
		}

		const body = capturedBody as {
			messages: Array<{ role: string; content: string }>;
		};
		const system = body.messages[0].content;
		expect(system).toContain("base instructions");
		expect(system).toContain("## Skill: tdd");
		expect(system).toContain("Write tests first.");
		expect(system).toContain("## Skill: git");
		expect(system).toContain("Use conventional commits.");
	});
});
