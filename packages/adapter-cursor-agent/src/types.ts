/**
 * Package-local types for `@sumeru/adapter-cursor-agent`.
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
 * Optional configuration for `createCursorAgentAdapter`. Every field accepts
 * `null` (or absence) to fall through to the defaults — no optional `?:`
 * properties on this surface.
 */
export type CursorAgentOptions = {
	/** Path to the `cursor-agent` executable. Defaults to `"cursor-agent"` (rely on $PATH). */
	cursorAgentBin: string | null;
	/**
	 * `--model` value passed on every spawn. Defaults to `null`, which means
	 * the adapter does NOT pass `--model` and lets cursor-agent use its default.
	 */
	model: string | null;
	/** Default timeout for `handle` spawns. Defaults to 10 minutes. */
	sendTimeoutMs: number | null;
	/**
	 * Test-only override for the streaming spawn used in `handle()`.
	 */
	streamingSpawnFn: StreamingSpawnFn | null;
	/**
	 * Test-only override for where init artifacts are written.
	 * Defaults to `process.env.HOME ?? process.cwd()`.
	 */
	homeDir: string | null;
	/**
	 * Controls permission bypass flag.
	 * `"force"` passes `--force`, `"yolo"` passes `--yolo`.
	 * Defaults to `"force"`.
	 */
	permissionMode: "force" | "yolo" | null;
	/** `--sandbox` value; defaults to `null` (do not pass flag). */
	sandbox: "enabled" | "disabled" | null;
};

/** Argument shape mirroring `child_process.spawn`. */
export type SpawnArgs = {
	command: string;
	args: string[];
	timeoutMs: number;
	cwd: string;
};

/**
 * Subtype of a parsed cursor-agent result — string-literal union.
 * The `"incomplete"` variant is synthesized by the parser when no `result`
 * line was emitted (process was killed or its stream truncated).
 */
export type CursorAgentResultSubtype = "success" | "incomplete";

/**
 * Intermediate parsed result from cursor-agent's
 * `--output-format stream-json` NDJSON output. The adapter consumes `turns`,
 * `sessionId`, `subtype`, and `usage` directly.
 */
export type CursorAgentParsedResult = {
	type: string;
	subtype: CursorAgentResultSubtype;
	result: string;
	sessionId: string;
	numTurns: number;
	durationMs: number;
	model: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
	};
	turns: TurnValue[];
};
