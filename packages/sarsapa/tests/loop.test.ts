import type { AdapterInboxMessage } from "@sumeru/adapter-core";
import { beforeEach, describe, expect, it } from "vitest";
import { createSarsapaAdapter } from "../src/agent.js";

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
	beforeEach(() => {
		process.env.SARSPA_TEST_KEY = "test-key";
	});

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
				apiKeyEnv: "SARSPA_TEST_KEY",
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
		const first = turns[0] as { toolCalls: unknown };
		expect(Array.isArray(first.toolCalls)).toBe(true);
		const doneValue = done as { tokenUsage: { input: number; output: number } };
		expect(doneValue.tokenUsage.input).toBe(30);
	});
});
