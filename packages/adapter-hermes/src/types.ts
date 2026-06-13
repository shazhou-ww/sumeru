/**
 * Public types for `@sumeru/adapter-hermes`.
 *
 * Most of the adapter contract lives in `@sumeru/core` (`Adapter`,
 * `NativeSessionRef`, `AgentResponse`). This module only declares package-
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
};

/** Pinned schema version for the Hermes session DB read by `getTurns`. */
export const SCHEMA_VERSION = 1 as const;

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
