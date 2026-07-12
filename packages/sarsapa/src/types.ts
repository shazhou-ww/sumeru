// @sumeru/sarsapa — internal types for the sarsapa worker agent.
import type { TokenUsage } from "@sumeru/core";

// === LLM message (provider-agnostic internal representation) ===
export type LlmRole = "system" | "user" | "assistant" | "tool";

export type LlmToolCall = {
	id: string;
	name: string;
	arguments: string; // JSON-encoded arguments string
};

export type LlmMessage = {
	role: LlmRole;
	content: string;
	toolCalls: Array<LlmToolCall> | null; // present on assistant messages that request tools
	toolCallId: string | null; // present on role:"tool" messages, links back to the call
};

// === Tool system ===
export type ToolContext = {
	cwd: string;
};

export type ToolResult = {
	output: string;
	exitCode: number | null;
	durationMs: number | null;
};

export type Tool = {
	name: string;
	description: string;
	parameters: Record<string, unknown>; // JSON Schema
	execute: (
		args: Record<string, unknown>,
		ctx: ToolContext,
	) => Promise<ToolResult>;
};

// === Options ===
export type SarsapaOptions = {
	maxIterations: number | null;
	fetchImpl: typeof fetch | null;
	tools: Array<Tool> | null;
	sessionPath: string | null;
};

export const DEFAULT_MAX_ITERATIONS = 40;

export type { TokenUsage };
