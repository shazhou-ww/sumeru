/**
 * Public types for `@sumeru/adapter-codex`.
 *
 * Most of the adapter contract lives in `@sumeru/core` (`Adapter`,
 * `NativeSessionRef`, `AgentResponse`, `Turn`, `ToolCall`, `TokenUsage`).
 * This module only declares package-local options, the parser's intermediate
 * shape, and the `child_process.spawn` test seam.
 */

import type { Turn } from "@sumeru/core";

/**
 * Optional configuration for `createCodexAdapter`. Every field accepts
 * `null` (or absence) to fall through to the defaults — no optional `?:`
 * properties on this surface.
 */
export type CodexAdapterOptions = {
	/** Path to the `codex` executable. Defaults to `"codex"` (rely on $PATH). */
	codexBin: string | null;
	/**
	 * `-m, --model` value passed on every spawn. Defaults to `null`, which means
	 * the adapter does NOT pass `--model` and lets Codex use its default.
	 */
	model: string | null;
	/** Working directory for the spawned process (`-C, --cd <DIR>`). Defaults to `process.cwd()`. */
	cwd: string | null;
	/** Default 5-minute timeout for `createSession`. */
	createSessionTimeoutMs: number | null;
	/** Default 30-minute timeout for `send` (consistent with adapter-claude-code). */
	sendTimeoutMs: number | null;
	/**
	 * Test-only override for `child_process.spawn`. Production code never
	 * passes this — the integration tests inject a fake to avoid spawning a
	 * real `codex` binary.
	 */
	spawnFn: SpawnFn | null;
	/**
	 * Whether to pass `--dangerously-bypass-approvals-and-sandbox` to Codex.
	 * Defaults to `true` for unattended Sumeru/uwf runs (parallel to
	 * `--dangerously-skip-permissions` in adapter-claude-code).
	 */
	dangerouslyBypassApprovals: boolean | null;
	/**
	 * Whether to pass `--skip-git-repo-check` to Codex. Defaults to `true`
	 * because Sumeru cwds may not always be git repos, and Codex refuses to
	 * run outside a git repo by default.
	 */
	skipGitRepoCheck: boolean | null;
};

/** Argument shape mirroring `child_process.spawn` minus the irrelevant overloads. */
export type SpawnArgs = {
	command: string;
	args: string[];
	timeoutMs: number;
	cwd: string;
};

/** Result of a spawned `codex` invocation. */
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
 * Subtype of a parsed Codex result — string-literal union, no widening to
 * `string`. The `"incomplete"` variant is synthesized by the parser when no
 * result line was emitted (Codex was killed or its stream truncated).
 */
export type CodexResultSubtype = "success" | "error" | "incomplete";

/**
 * Intermediate parsed result from Codex's `--json` JSONL output. Unlike the
 * uwf reference, Sumeru does NOT persist this — the server layer handles ocas
 * writes. The adapter consumes `turns`, `sessionId`, `subtype`, and `usage`.
 */
export type CodexParsedResult = {
	type: string;
	subtype: CodexResultSubtype;
	result: string;
	sessionId: string;
	numTurns: number;
	durationMs: number;
	model: string;
	stopReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
	};
	turns: Turn[];
};
