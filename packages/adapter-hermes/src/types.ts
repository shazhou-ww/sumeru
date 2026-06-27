import type { TurnValue } from "@sumeru/core";

export type HermesAdapterOptions = {
	profile: string;
	hermesBin: string | null;
	hermesDir: string | null;
	spawnFn: SpawnFn | null;
	jsonlReader: JsonlReader | null;
	sendTimeoutMs: number | null;
};

export type SpawnArgs = {
	command: string;
	args: Array<string>;
	stdin: string;
	timeoutMs: number;
	cwd: string;
};

export type SpawnResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	durationMs: number;
};

export type SpawnFn = (args: SpawnArgs) => Promise<SpawnResult>;

export type JsonlReader = (
	sessionsDir: string,
	nativeId: string,
) => Promise<Array<TurnValue> | null>;
