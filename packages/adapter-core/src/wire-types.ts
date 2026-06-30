// Adapter NDJSON wire payload types. Not part of the public @sumeru/core v3 API.

import type { TokenUsage } from "@sumeru/core";

export type InboxMessage = {
	messageId: string;
	content: string;
	project: string | null;
};

export type WireToolCall = {
	tool: string;
	input: Record<string, unknown>;
	output: string | null;
	durationMs: number | null;
	exitCode: number | null;
};

export type TurnValue = {
	index: number;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
	toolCalls: Array<WireToolCall> | null;
	tokens: TokenUsage | null;
	// Wall-clock duration of this turn in milliseconds. null means the producer
	// did not measure it; the host then derives it from frame arrival timing
	// (see packages/host/src/session-manager.ts). Never the sum of tool-call
	// durations (#178).
	durationMs: number | null;
};

export type DoneValue = {
	summary: string | null;
	tokenUsage: TokenUsage | null;
};

export type SuspendValue = {
	reason: "timeout" | "permissionRequest" | "inputRequired";
	elapsedMs: number;
};

export type WireErrorValue = {
	code: string;
	message: string;
};

export type OutboxFrame =
	| { type: "turn"; value: TurnValue }
	| { type: "done"; value: DoneValue }
	| { type: "suspend"; value: SuspendValue }
	| { type: "error"; value: WireErrorValue };
