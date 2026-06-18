/**
 * Public types for `@sumeru/adapter-hermes`.
 *
 * Most of the adapter contract lives in `@sumeru/core` (`Adapter`,
 * `NativeSessionRef`, `SendEvent`). This module only declares package-
 * local options and the SQLite row mapping pinned by the adapter.
 */

/**
 * Optional configuration for `createHermesAdapter`. Every field accepts
 * `null` (or absence) to fall through to the defaults documented below —
 * no optional `?:` properties on this surface.
 */
export type HermesAdapterOptions = {
	/** Path to the `hermes` executable. Defaults to `"hermes"` (rely on $PATH). */
	hermesBin: string | null;
	/** `--source` value used when invoking `hermes chat`. Defaults to `"sumeru"`. */
	sourceTag: string | null;
	/** Path to the SQLite session DB. Defaults to `~/.hermes/sessions.db`. */
	dbPath: string | null;
	/**
	 * Directory holding per-session `<nativeId>.jsonl` files (hermes v0.15.1+).
	 * Defaults to `~/.hermes/sessions`.
	 */
	sessionsDir: string | null;
	/** Default 60_000 ms timeout for `createSession`. */
	createSessionTimeoutMs: number | null;
	/** Default 5-minute timeout for `send`. */
	sendTimeoutMs: number | null;
	/** Include system-role turns in `send`/`getTurns` output. Default false. */
	includeSystemTurns: boolean | null;
	/**
	 * Test-only override for `child_process.spawn`. Production code never
	 * passes this; the integration tests inject a fake to avoid shelling out.
	 */
	spawnFn: SpawnFn | null;
	/**
	 * Test-only override for the SQLite reader. Production code uses
	 * `node:sqlite`; tests can swap in an in-memory map of `nativeId → Turn[]`.
	 */
	turnsReader: TurnsReader | null;
	/**
	 * Test-only override for the JSONL reader. Production code reads
	 * `<sessionsDir>/<nativeId>.jsonl`. Returns `null` to signal "not present /
	 * unparseable, fall through to DB"; returns a `Turn[]` (possibly empty) on
	 * a clean read.
	 */
	jsonlReader: JsonlReader | null;
};

/** Pinned schema version for the legacy Hermes session DB read by `getTurns`. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Pinned schema version for the uwf-shaped Hermes session DB
 * (`sessions(id, model, started_at, input_tokens, output_tokens)` +
 * `messages(session_id, role, content, reasoning, tool_calls)`).
 * Used as fallback when the JSONL file is absent.
 */
export const SCHEMA_VERSION_DB = 2 as const;

/** Argument shape mirroring `child_process.spawn` minus the irrelevant overloads. */
export type SpawnArgs = {
	command: string;
	args: string[];
	timeoutMs: number;
};

/** Result of a spawned `hermes` invocation. */
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

/** Test seam for the SQLite turn reader. */
export type TurnsReader = (
	dbPath: string,
	nativeId: string,
) => Promise<import("@sumeru/core").Turn[]>;

/**
 * Test seam for the JSONL turn reader (hermes v0.15.1+).
 * `null` return signals "fall through to DB"; a Turn array (possibly empty)
 * is treated as the authoritative read.
 */
export type JsonlReader = (
	sessionsDir: string,
	nativeId: string,
) => Promise<import("@sumeru/core").Turn[] | null>;
