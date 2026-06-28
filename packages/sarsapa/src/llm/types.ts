import type { TokenUsage } from "@sumeru/core";
import type { LlmMessage, LlmToolCall } from "../types.js";

export type ToolSchema = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
};

export type LlmRequest = {
	model: string;
	apiKeyEnv: string;
	baseUrl: string | null;
	messages: Array<LlmMessage>;
	tools: Array<ToolSchema>;
	signal: AbortSignal | null;
	fetchImpl: typeof fetch | null;
};

export type LlmResponse = {
	content: string;
	toolCalls: Array<LlmToolCall> | null;
	tokens: TokenUsage | null;
};
