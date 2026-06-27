// @sumeru/core — shared type definitions (M1 minimal type set).
// Authoritative source: package-design wiki §1 "@sumeru/core — 共享类型".
// Zero runtime: this module is type-only (no runtime values, functions, or classes).

// === Manifest & Model ===
export type Manifest = {
	name: string;
	model: ModelConfig;
	instructions: string;
	skills: Array<string>;
};
export type ModelConfig = {
	provider: KnownProvider | CustomProvider;
	name: string;
	apiKeyEnv: string;
	contextWindow: number;
};
export type KnownProvider = "anthropic" | "openai" | "openrouter";
export type CustomProvider = {
	baseUrl: string;
	apiType: "openai" | "anthropic";
};

// === Instance ===
export type InstanceId = string; // inst_<ULID>, master 固定 inst_0
export type InstanceStatus = "running" | "stopped" | "idle" | "suspended";
export type InstanceInfo = {
	id: InstanceId;
	prototype: string | null; // null = master
	status: InstanceStatus;
	createdAt: string; // ISO timestamp
	projects: Array<string>;
};

// === 消息协议 (Host <-> Adapter NDJSON 帧) ===
export type InboxMessage = {
	messageId: string;
	content: string;
	project: string | null;
};
export type OutboxFrame =
	| { type: "turn"; value: TurnValue }
	| { type: "done"; value: DoneValue }
	| { type: "suspend"; value: SuspendValue }
	| { type: "error"; value: ErrorValue };
export type TurnValue = {
	index: number;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
	toolCalls: Array<ToolCall> | null;
	tokens: TokenUsage | null;
};
export type ToolCall = {
	tool: string;
	input: Record<string, unknown>;
	output: string | null;
	durationMs: number | null;
	exitCode: number | null;
};
export type DoneValue = {
	summary: string | null;
	tokenUsage: TokenUsage | null;
};
export type SuspendValue = {
	reason: "timeout" | "permissionRequest" | "inputRequired";
	elapsedMs: number;
};
export type ErrorValue = {
	code: string;
	message: string;
};
export type TokenUsage = {
	input: number;
	output: number;
};

// === Host 配置 ===
export type HostConfig = {
	name: string;
	master: MasterConfig;
	resources: ResourceLimits;
	dataDir: string | null;
};
export type MasterConfig = {
	adapter: string;
	config: Record<string, unknown>;
};
export type ResourceLimits = {
	maxMemory: string;
	maxCpus: number;
	maxInstances: number;
};
