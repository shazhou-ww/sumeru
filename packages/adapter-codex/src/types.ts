/**
 * Package-local types for `@sumeru/adapter-codex` (v2).
 */

import type { TurnValue } from "@sumeru/core";

export type SpawnExitInfo = {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	durationMs: number;
	stderr: string;
};

export type SpawnStreamResult = {
	lines: AsyncIterable<string>;
	waitForExit(): Promise<SpawnExitInfo>;
};

export type StreamingSpawnFn = (args: SpawnArgs) => SpawnStreamResult;

export type StreamParseEvent =
	| { type: "turn"; turn: TurnValue }
	| { type: "meta"; sessionId: string; model: string }
	| { type: "result"; resultLine: Record<string, unknown> };

export type CodexAdapterOptions = {
	codexBin: string | null;
	model: string | null;
	sendTimeoutMs: number | null;
	streamingSpawnFn: StreamingSpawnFn | null;
	dangerouslyBypassApprovals: boolean | null;
	skipGitRepoCheck: boolean | null;
	homeDir: string | null;
};

export type SpawnArgs = {
	command: string;
	args: Array<string>;
	timeoutMs: number;
	cwd: string;
};

export type CodexResultSubtype = "success" | "error" | "incomplete";

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
	turns: Array<TurnValue>;
};
