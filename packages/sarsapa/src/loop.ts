import type { AdapterHandleYield } from "@sumeru/adapter-core";
import type { DoneValue, ToolCall, TurnValue } from "@sumeru/core";
import type { Conversation } from "./context.js";
import { pushAssistant, pushToolResult, toMessages } from "./context.js";
import { chat } from "./llm/client.js";
import type { LlmRequest, ToolSchema } from "./llm/types.js";
import type { LlmToolCall, Tool, ToolContext } from "./types.js";

export type LoopOptions = {
	model: string;
	apiKey: string;
	baseUrl: string | null;
	conversation: Conversation;
	tools: Array<Tool>;
	toolSchemas: Array<ToolSchema>;
	ctx: ToolContext;
	fetchImpl: typeof fetch | null;
	maxIterations: number;
};

function nowIso(): string {
	return new Date().toISOString();
}

async function executeToolCall(
	call: LlmToolCall,
	tools: Array<Tool>,
	ctx: ToolContext,
): Promise<ToolCall> {
	const tool = tools.find((t) => t.name === call.name) ?? null;
	let parsedArgs: Record<string, unknown>;
	let parseError: string | null = null;
	try {
		parsedArgs = JSON.parse(call.arguments) as Record<string, unknown>;
	} catch (err) {
		parsedArgs = {};
		parseError = err instanceof Error ? err.message : String(err);
	}
	if (parseError !== null) {
		return {
			tool: call.name,
			input: parsedArgs,
			output: `Error: arguments is not valid JSON (${parseError}). Make sure string values escape newlines as \\n and quotes as \\". Raw (first 300 chars): ${call.arguments.slice(0, 300)}`,
			durationMs: null,
			exitCode: 1,
		};
	}
	if (tool === null) {
		return {
			tool: call.name,
			input: parsedArgs,
			output: `Error: unknown tool '${call.name}'`,
			durationMs: null,
			exitCode: null,
		};
	}
	const start = Date.now();
	try {
		const result = await tool.execute(parsedArgs, ctx);
		return {
			tool: call.name,
			input: parsedArgs,
			output: result.output,
			durationMs: result.durationMs,
			exitCode: result.exitCode,
		};
	} catch (err) {
		// surface the real error to the LLM — do not swallow or guess.
		const msg = err instanceof Error ? err.message : String(err);
		return {
			tool: call.name,
			input: parsedArgs,
			output: `Error: tool '${call.name}' threw (${msg})`,
			durationMs: Date.now() - start,
			exitCode: 1,
		};
	}
}

export async function* runLoop(
	opts: LoopOptions,
): AsyncGenerator<AdapterHandleYield, DoneValue> {
	const { conversation, tools, toolSchemas, ctx } = opts;
	let inputTokens = 0;
	let outputTokens = 0;
	let index = 0;

	for (let iter = 0; iter < opts.maxIterations; iter += 1) {
		const request: LlmRequest = {
			model: opts.model,
			apiKey: opts.apiKey,
			baseUrl: opts.baseUrl,
			messages: toMessages(conversation),
			tools: toolSchemas,
			signal: null,
			fetchImpl: opts.fetchImpl,
		};
		const res = await chat(request);
		if (res.tokens !== null) {
			inputTokens += res.tokens.input;
			outputTokens += res.tokens.output;
		}

		if (res.toolCalls === null) {
			const turn: TurnValue = {
				index,
				role: "assistant",
				content: res.content,
				timestamp: nowIso(),
				toolCalls: null,
				tokens: res.tokens,
			};
			yield turn;
			return {
				summary: null,
				tokenUsage: { input: inputTokens, output: outputTokens },
			};
		}

		// assistant message (with tool_calls) must precede tool results
		pushAssistant(conversation, res.content, res.toolCalls);

		// Tool calls issued in one turn are independent — execute them in
		// parallel. The LLM decides whether to batch; the runtime should not
		// artificially serialize. Promise.all preserves tool-call order.
		const results = await Promise.all(
			res.toolCalls.map((call) => executeToolCall(call, tools, ctx)),
		);
		for (const [i, call] of res.toolCalls.entries()) {
			pushToolResult(conversation, call.id, results[i].output ?? "");
		}
		const executed: Array<ToolCall> = results;

		const turn: TurnValue = {
			index,
			role: "assistant",
			content: res.content,
			timestamp: nowIso(),
			toolCalls: executed,
			tokens: res.tokens,
		};
		index += 1;
		yield turn;
	}

	return {
		summary: "max iterations reached",
		tokenUsage: { input: inputTokens, output: outputTokens },
	};
}
