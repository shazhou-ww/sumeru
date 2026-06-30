// @sumeru/core — shared type definitions (v3).
// Authoritative source: spec-v3 wiki + issue #159.
// Zero runtime: this module is type-only (no runtime values, functions, or classes).

// === Token usage ===
export type TokenUsage = {
	input: number;
	output: number;
	cached: number;
};

// === Model ===
export type KnownProvider = "anthropic" | "openai" | "openrouter";
export type CustomProvider = {
	name: string;
	endpoint: string;
	apiType: "openai" | "anthropic";
};
export type ModelConfig = {
	provider: KnownProvider | CustomProvider;
	name: string;
	apiKey: string | null;
};

// === Prototype ===
export type Prototype = {
	name: string;
	instructions: string;
	skills: Array<string>;
	defaults: {
		maxTurns: number;
		timeout: number;
		resources: {
			cpu: number;
			memory: string;
		};
	} | null;
};

// === Session ===
export type SessionStatus = "running" | "idle";
export type ExitBase = {
	elapsedMs: number;
	turnCount: number;
	tokenUsage: TokenUsage;
};
export type ExitSignal = ExitBase &
	(
		| { type: "complete"; message: string }
		| { type: "failed"; message: string }
		| { type: "needsInput"; message: string }
		| { type: "timeout" }
		| { type: "stopped" }
		| { type: "exhausted" }
	);
export type SessionInfo = {
	id: string;
	prototype: string;
	model: ModelConfig;
	image: string;
	project: string;
	task: string;
	status: SessionStatus;
	exit: ExitSignal | null;
	createdAt: string;
};

// === Turn stream ===
export type ToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};
export type AssistantTurn = {
	id: number;
	role: "assistant";
	content: string;
	toolCalls: Array<ToolCall>;
	// null when the adapter did not report token usage for this turn — do NOT
	// fabricate { input: 0, output: 0, cached: 0 } to represent "unknown" (#178).
	tokenUsage: TokenUsage | null;
	// Wall-clock milliseconds from turn start to adapter response; always >= 1
	// for an emitted turn. Never derived from the sum of tool-call durations.
	durationMs: number;
	timestamp: string;
};
export type ToolTurn = {
	id: number;
	role: "tool";
	callId: string;
	name: string;
	result: string;
	durationMs: number;
	timestamp: string;
};
export type Turn = AssistantTurn | ToolTurn;

// === Image ===
export type Image = {
	name: string;
	description: string;
	dockerfile: string;
	builtAt: string;
	digest: string;
};

// === Host 配置 ===
export type HostConfig = {
	name: string;
	maxRunning: number;
	workspaceRoot: string;
	envFile: string;
	models: {
		anthropic: {
			baseUrl: string | null;
			apiKey: string;
			model: string | null;
		} | null;
		openai: {
			baseUrl: string | null;
			apiKey: string;
			model: string | null;
		} | null;
		openrouter: {
			baseUrl: string | null;
			apiKey: string;
			model: string | null;
		} | null;
	};
	resourceLimits: { maxCpu: number; maxMemory: string } | null;
	defaults: {
		timeout: number;
		maxTurns: number;
		resources: { cpu: number; memory: string };
	} | null;
};
