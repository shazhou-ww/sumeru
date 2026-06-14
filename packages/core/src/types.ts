/**
 * Sumeru — Agent house HTTP service.
 *
 * Core type definitions: Adapter contract, Turn/ToolCall data shapes, and
 * legacy scene/recording types (planned Docker mode).
 */

// ─── Scene ───────────────────────────────────────────────

/** A scene defines the world + task. No agent assumptions. */
export type Scene = {
	/** Unique scene identifier (kebab-case) */
	name: string;
	/** Human-readable description */
	description: string;
	/** Tools that must be available in the environment */
	tools: string[];
	/** Pre-loaded knowledge (runner places these per agent type) */
	knowledge: Knowledge | null;
	/** The task prompt — natural language, agent-agnostic */
	task: string;
}

export type Knowledge = {
	/** Skill definitions to pre-install */
	skills: SkillDef[] | null;
	/** Memory entries to pre-load */
	memory: string[] | null;
}

export type SkillDef = {
	/** Skill name */
	name: string;
	/** Skill content (markdown) */
	content: string;
}

// ─── Run Config (runtime, not part of scene) ────────────

/** Runtime configuration — how to execute a scene */
export type RunConfig = {
	/** Which scene to run */
	scene: string;
	/** Runner type (hermes, claude-code, codex, etc.) */
	runner: string;
	/** Model to use */
	model: string;
	/** Timeout in seconds */
	timeout: number;
	/** Whether network access is allowed */
	network: boolean;
	/** Docker image to use */
	image: string;
}

// ─── Recording ───────────────────────────────────────────

/** A recording captures everything that happened during a run */
export type Recording = {
	/** Metadata */
	meta: RecordingMeta;
	/** Full sequence of turns */
	turns: Turn[];
}

export type RecordingMeta = {
	/** Scene name */
	scene: string;
	/** Runner used */
	runner: string;
	/** Model used */
	model: string;
	/** ISO timestamp of run start */
	startedAt: string;
	/** ISO timestamp of run end */
	endedAt: string;
	/** Duration in milliseconds */
	durationMs: number;
	/** How the run ended */
	exit: "completed" | "timeout" | "error";
	/** Total turn count */
	turnCount: number;
	/** Token usage */
	tokens: TokenUsage | null;
}

export type TokenUsage = {
	input: number;
	output: number;
}

// ─── Turn ────────────────────────────────────────────────

/** A single turn in the conversation */
export type Turn = {
	/** Turn sequence number (0-indexed) */
	index: number;
	/** Role */
	role: "user" | "assistant" | "system";
	/** Text content */
	content: string;
	/** ISO timestamp */
	timestamp: string;
	/** Tool calls made in this turn (assistant only) */
	toolCalls: ToolCall[] | null;
	/** Token usage for this turn */
	tokens: TokenUsage | null;
	/**
	 * Ocas content-addressed hash of this turn. Adapters return `null`; the
	 * server replaces it with the computed hash before emitting SSE / history
	 * responses. The hash is NOT stored inside the recorded payload (would be
	 * circular).
	 */
	hash: string | null;
}

export type ToolCall = {
	/** Tool name (e.g. "terminal", "read_file") */
	tool: string;
	/** Input arguments */
	input: Record<string, unknown>;
	/** Full output (untruncated) */
	output: string;
	/** Duration in milliseconds */
	durationMs: number;
	/** Exit code (for terminal calls) */
	exitCode: number | null;
}
