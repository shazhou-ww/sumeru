/**
 * Sumeru — Agent behavior observation lab
 *
 * Core type definitions for scenes, runs, and recordings.
 * Designed to be agent-agnostic: scenes define the world,
 * runners handle the how, recordings capture what happened.
 */

// ─── Scene ───────────────────────────────────────────────

/** A scene defines the world + task. No agent assumptions. */
export interface Scene {
	/** Unique scene identifier (kebab-case) */
	name: string;
	/** Human-readable description */
	description: string;
	/** Tools that must be available in the environment */
	tools: string[];
	/** Pre-loaded knowledge (runner places these per agent type) */
	knowledge?: Knowledge;
	/** The task prompt — natural language, agent-agnostic */
	task: string;
}

export interface Knowledge {
	/** Skill definitions to pre-install */
	skills?: SkillDef[];
	/** Memory entries to pre-load */
	memory?: string[];
}

export interface SkillDef {
	/** Skill name */
	name: string;
	/** Skill content (markdown) */
	content: string;
}

// ─── Run Config (runtime, not part of scene) ────────────

/** Runtime configuration — how to execute a scene */
export interface RunConfig {
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
export interface Recording {
	/** Metadata */
	meta: RecordingMeta;
	/** Full sequence of turns */
	turns: Turn[];
}

export interface RecordingMeta {
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
	tokens?: TokenUsage;
}

export interface TokenUsage {
	input: number;
	output: number;
}

// ─── Turn ────────────────────────────────────────────────

/** A single turn in the conversation */
export interface Turn {
	/** Turn sequence number (0-indexed) */
	index: number;
	/** Role */
	role: "user" | "assistant" | "system";
	/** Text content */
	content: string;
	/** ISO timestamp */
	timestamp: string;
	/** Tool calls made in this turn (assistant only) */
	toolCalls?: ToolCall[];
	/** Token usage for this turn */
	tokens?: TokenUsage;
}

export interface ToolCall {
	/** Tool name (e.g. "terminal", "read_file") */
	tool: string;
	/** Input arguments */
	input: Record<string, unknown>;
	/** Full output (untruncated) */
	output: string;
	/** Duration in milliseconds */
	durationMs: number;
	/** Exit code (for terminal calls) */
	exitCode?: number;
}
