/**
 * Public surface of `@sumeru/adapter-claude-code`.
 *
 * The factory `createClaudeCodeAdapter` returns an `Adapter` (from
 * `@sumeru/core`) that drives Claude Code via its CLI in
 * `--output-format stream-json --verbose --dangerously-skip-permissions`
 * mode. See `adapter.ts` for the implementation.
 */

export { createClaudeCodeAdapter } from "./adapter.js";
export {
	parseStreamJson,
	parseStreamJsonIncremental,
} from "./stream-parser.js";
export type {
	ClaudeCodeAdapterOptions,
	ClaudeCodeParsedResult,
	ClaudeCodeResultSubtype,
	SpawnArgs,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
	StreamParseEvent,
} from "./types.js";
