// v2 instance / adapter wire types retained locally until the host session layer
// migrates to v3 SessionInfo / Turn. Not exported from @sumeru/core in v3.

import type { TokenUsage } from "@sumeru/core";

export type InstanceId = string;

export type InstanceStatus = "running" | "stopped" | "idle" | "suspended";

export type InstanceInfo = {
	id: InstanceId;
	prototype: string | null;
	status: InstanceStatus;
	createdAt: string;
	projects: Array<string>;
};

export type InboxMessage = {
	messageId: string;
	content: string;
	project: string | null;
};

export type LegacyToolCall = {
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
	toolCalls: Array<LegacyToolCall> | null;
	tokens: TokenUsage | null;
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
