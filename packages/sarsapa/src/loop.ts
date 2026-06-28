import type { AdapterHandleYield } from "@sumeru/adapter-core";
import type { DoneValue, ToolCall, TurnValue } from "@sumeru/core";
import type { Conversation } from "./context.js";
import { pushAssistant, pushToolResult, toMessages } from "./context.js";
import { chat } from "./llm/client.js";
import type { LlmRequest, ToolSchema } from "./llm/types.js";
import type { LlmToolCall, Tool, ToolContext } from "./types.js";

export type LoopOptions = {
	model: string;
	apiKeyEnv: string;
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
	try {
		parsedArgs = JSON.parse(call.arguments) as Record<string, unknown>;
	} catch {
		parsedArgs = {};
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
	const result = await tool.execute(parsedArgs, ctx);
	return {
		tool: call.name,
		input: parsedArgs,
		output: result.output,
		durationMs: result.durationMs,
		exitCode: result.exitCode,
	};
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
			apiKeyEnv: opts.apiKeyEnv,
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

		const executed: Array<ToolCall> = [];
		for (const call of res.toolCalls) {
			const tc = await executeToolCall(call, tools, ctx);
			executed.push(tc);
			pushToolResult(conversation, call.id, tc.output ?? "");
		}

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
