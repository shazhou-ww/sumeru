import type { AdapterInboxMessage, WireToolCall } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createSarsapaAdapter } from "../src/agent.js";
import type { Tool } from "../src/types.js";

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
		const adapter = createSarsapaAdapter({
			fetchImpl: mockFetch(),
			maxIterations: 5,
		});
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
		const adapter = createSarsapaAdapter({
			fetchImpl: mockFetchWithToolCall("nonexistent_tool", '{"x":1}'),
			maxIterations: 5,
			tools: [], // no tools registered
		});
		await adapter.init(INIT_CONFIG);
		const { turns, done } = await collectTurns(adapter);

		expect(turns.length).toBe(2);
		const tc = turns[0].toolCalls?.[0];
		expect(tc).toBeDefined();
		expect(tc!.id).toBe("call_err");
		expect(tc!.output).toContain("Error: unknown tool");
		expect(tc!.exitCode).toBeNull();
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
		const adapter = createSarsapaAdapter({
			fetchImpl: mockFetchWithToolCall("dummy", "NOT_JSON{{{"),
			maxIterations: 5,
			tools: [dummyTool],
		});
		await adapter.init(INIT_CONFIG);
		const { turns, done } = await collectTurns(adapter);

		expect(turns.length).toBe(2);
		const tc = turns[0].toolCalls?.[0];
		expect(tc).toBeDefined();
		expect(tc!.id).toBe("call_err");
		expect(tc!.output).toContain("Error: arguments is not valid JSON");
		expect(tc!.exitCode).toBe(1);
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
		const adapter = createSarsapaAdapter({
			fetchImpl: mockFetchWithToolCall("exploder", "{}"),
			maxIterations: 5,
			tools: [throwingTool],
		});
		await adapter.init(INIT_CONFIG);
		const { turns, done } = await collectTurns(adapter);

		expect(turns.length).toBe(2);
		const tc = turns[0].toolCalls?.[0];
		expect(tc).toBeDefined();
		expect(tc!.id).toBe("call_err");
		expect(tc!.output).toContain("Error: tool 'exploder' threw");
		expect(tc!.output).toContain("kaboom");
		expect(tc!.exitCode).toBe(1);
		expect(tc!.durationMs).toBeGreaterThanOrEqual(0);
		expect(done).toBeDefined();
	});
});
