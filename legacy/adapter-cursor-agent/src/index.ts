/**
 * Public surface of `@sumeru/adapter-cursor-agent`.
 *
 * The factory `createCursorAgentAdapter` returns an `Adapter` (from
 * `@sumeru/core`) that drives cursor-agent via its CLI in
 * `--print --output-format stream-json --trust --force` mode.
 * See `adapter.ts` for the implementation.
 */

export { createCursorAgentAdapter } from "./adapter.js";
export {
	parseStreamJson,
	parseStreamJsonIncremental,
} from "./stream-parser.js";
export type {
	CursorAgentAdapterOptions,
	CursorAgentParsedResult,
	CursorAgentResultSubtype,
	SpawnArgs,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
	StreamParseEvent,
} from "./types.js";
