/**
 * Public types for `@sumeru/adapter-cursor-agent`.
 *
 * The adapter contract lives in `@sumeru/core` (`Adapter`, `NativeSessionRef`,
 * `AgentResponse`, `Turn`, `ToolCall`, `TokenUsage`). This module only declares
 * package-local options, the parser's intermediate shape, and the
 * `child_process.spawn` test seam.
 */

import type { Turn } from "@sumeru/core";

/**
 * Optional configuration for `createCursorAgentAdapter`. Every field accepts
 * `null` (or absence) to fall through to the defaults — no optional `?:`
 * properties on this surface.
 */
export type CursorAgentAdapterOptions = {
	/** Path to the `cursor-agent` executable. Defaults to `"cursor-agent"` (rely on $PATH). */
	cursorAgentBin: string | null;
	/**
	 * `--model` value passed on every spawn. Defaults to `null`, which means
	 * the adapter does NOT pass `--model` and lets cursor-agent use its default.
	 */
	model: string | null;
	/** Working directory for the spawned process. Passed as `--workspace <path>`. Defaults to `process.cwd()`. */
	cwd: string | null;
	/** Default 5-minute timeout for `createSession`. */
	createSessionTimeoutMs: number | null;
	/** Default 10-minute timeout for `send`. */
	sendTimeoutMs: number | null;
	/**
	 * Test-only override for `child_process.spawn`. Production code never
	 * passes this — the integration tests inject a fake to avoid spawning a
	 * real `cursor-agent` binary.
	 */
	spawnFn: SpawnFn | null;
	/**
	 * Controls permission bypass flag.
	 * `"force"` passes `--force`, `"yolo"` passes `--yolo`.
	 * Defaults to `"force"`.
	 */
	permissionMode: "force" | "yolo" | null;
	/** `--sandbox` value; defaults to `null` (do not pass flag). */
	sandbox: "enabled" | "disabled" | null;
};

/** Argument shape mirroring `child_process.spawn` minus the irrelevant overloads. */
export type SpawnArgs = {
	command: string;
	args: string[];
	timeoutMs: number;
	cwd: string;
};

/** Result of a spawned `cursor-agent` invocation. */
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
	turns: Turn[];
};
