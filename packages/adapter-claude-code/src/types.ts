/**
 * Public types for `@sumeru/adapter-claude-code`.
 *
 * Most of the adapter contract lives in `@sumeru/core` (`Adapter`,
 * `NativeSessionRef`, `AgentResponse`, `Turn`, `ToolCall`, `TokenUsage`).
 * This module only declares package-local options, the parser's intermediate
 * shape, and the `child_process.spawn` test seam.
 */

import type { Turn } from "@sumeru/core";

/**
 * Optional configuration for `createClaudeCodeAdapter`. Every field accepts
 * `null` (or absence) to fall through to the defaults — no optional `?:`
 * properties on this surface.
 */
export type ClaudeCodeAdapterOptions = {
	/** Path to the `claude` executable. Defaults to `"claude"` (rely on $PATH). */
	claudeBin: string | null;
	/**
	 * `--model` value passed on every spawn. Defaults to `null`, which means
	 * the adapter does NOT pass `--model` and lets Claude Code use its default.
	 */
	model: string | null;
	/** Value of `--max-turns`. Defaults to `90` (matches the uwf reference). */
	maxTurns: number | null;
	/** Working directory for the spawned process. Defaults to `process.cwd()`. */
	cwd: string | null;
	/** Default 5-minute timeout for `createSession`. */
	createSessionTimeoutMs: number | null;
	/** Default 30-minute timeout for `send` (raised from 10 min by issue #32 — CC sessions can be long). */
	sendTimeoutMs: number | null;
	/**
	 * Test-only override for `child_process.spawn`. Production code never
	 * passes this — the integration tests inject a fake to avoid spawning a
	 * real `claude` binary.
	 */
	spawnFn: SpawnFn | null;
};

/** Argument shape mirroring `child_process.spawn` minus the irrelevant overloads. */
export type SpawnArgs = {
	command: string;
	args: string[];
	timeoutMs: number;
	cwd: string;
};

/** Result of a spawned `claude` invocation. */
export type SpawnResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	durationMs: number;
};

/** Test seam for `child_process.spawn`. */
export type SpawnFn = (args: SpawnArgs) => Promise<SpawnResult>;

/**
 * Subtype of a parsed Claude Code result line — string-literal union, no
 * widening to `string`. The `"incomplete"` variant is synthesized by the
 * parser when no `result` line was emitted (CC was killed or its stream
 * truncated).
 */
export type ClaudeCodeResultSubtype =
	| "success"
	| "error_max_turns"
	| "error_budget"
	| "incomplete";

/**
 * Intermediate parsed result from CC's `--output-format stream-json --verbose`
 * NDJSON output. Unlike the uwf reference, Sumeru does NOT persist this —
 * the server layer handles ocas writes. The adapter consumes `turns`,
 * `sessionId`, `subtype`, and `usage` directly.
 */
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
	turns: Turn[];
};
