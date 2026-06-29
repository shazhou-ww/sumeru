/**
 * Package-local types for `@sumeru/adapter-claude-code`.
 * Wire payload types (`TurnValue`, `DoneValue`, …) live in `@sumeru/adapter-core`.
 */

import type { TurnValue } from "@sumeru/adapter-core";

/** Post-exit metadata from a streaming spawn. */
export type SpawnExitInfo = {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	durationMs: number;
	stderr: string;
};

/** Return value of `StreamingSpawnFn` — lines + exit promise. */
export type SpawnStreamResult = {
	lines: AsyncIterable<string>;
	waitForExit(): Promise<SpawnExitInfo>;
};

/** Streaming spawn test seam — returns synchronously with incremental stdout access. */
export type StreamingSpawnFn = (args: SpawnArgs) => SpawnStreamResult;

/** Events yielded by the incremental stream parser. */
export type StreamParseEvent =
	| { type: "turn"; turn: TurnValue }
	| { type: "meta"; sessionId: string; model: string }
	| { type: "result"; resultLine: Record<string, unknown> };

/**
 * Optional configuration for `createClaudeCodeAdapter`. Every field accepts
 * `null` (or absence) to fall through to the defaults.
 */
export type ClaudeCodeOptions = {
	/** Path to the `claude` executable. Defaults to `"claude"`. */
	claudeBin: string | null;
	/**
	 * `--model` value passed on every spawn. Defaults to `null`, which means
	 * the adapter does NOT pass `--model` and lets Claude Code use its default.
	 */
	model: string | null;
	/** Value of `--max-turns`. Defaults to `90`. */
	maxTurns: number | null;
	/** Default timeout for `handle` spawns. Defaults to 2 hours. */
	sendTimeoutMs: number | null;
	/**
	 * Test-only override for the streaming spawn used in `handle()`.
	 */
	streamingSpawnFn: StreamingSpawnFn | null;
	/**
	 * Test-only override for where init artifacts (CLAUDE.md, skills) are written.
	 * Defaults to `process.env.HOME ?? process.cwd()`.
	 */
	homeDir: string | null;
};

/** Argument shape mirroring `child_process.spawn`. */
export type SpawnArgs = {
	command: string;
	args: string[];
	timeoutMs: number;
	cwd: string;
};

/** Result subtype from Claude Code's stream-json `result` line. */
export type ClaudeCodeResultSubtype =
	| "success"
	| "error_max_turns"
	| "error_budget"
	| "incomplete";

/** Parsed outcome of a full stream-json capture (batch parser). */
export type ClaudeCodeParsedResult = {
	type: string;
	subtype: ClaudeCodeResultSubtype;
	result: string;
	sessionId: string;
	numTurns: number;
	totalCostUsd: number;
	durationMs: number;
	model: string;
	stopReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadInputTokens: number;
		cacheCreationInputTokens: number;
	};
	turns: TurnValue[];
};
