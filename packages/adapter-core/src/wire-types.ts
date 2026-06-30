// Adapter NDJSON wire payload types. Not part of the public @sumeru/core v3 API.

import type { TokenUsage } from "@sumeru/core";

export type InboxMessage = {
	messageId: string;
	content: string;
	project: string | null;
};

export type WireToolCall = {
	id: string;
	tool: string;
	input: Record<string, unknown>;
	output: string | null;
	durationMs: number | null;
	exitCode: number | null;
};

export type TurnValue = AssistantTurnValue | ToolTurnValue;

// The assistant/user/system variant. `role` discriminates against the tool
// variant below. This is the original wire turn shape (#178).
export type AssistantTurnValue = {
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

// An independent tool-result turn, emitted progressively after the assistant
// turn that requested the call (#182). Carries only tool-turn fields — never
// `content` / `toolCalls` / `tokens`. The host surfaces it as a public
// `ToolTurn` (see packages/host/src/wire-turn.ts) instead of deriving one from
// `WireToolCall.output`.
export type ToolTurnValue = {
	index: number;
	role: "tool";
	name: string;
	callId: string;
	result: string;
	durationMs: number | null;
	timestamp: string;
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
