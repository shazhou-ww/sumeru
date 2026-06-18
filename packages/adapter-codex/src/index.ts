/**
 * Public surface of `@sumeru/adapter-codex`.
 *
 * The factory `createCodexAdapter` returns an `Adapter` (from
 * `@sumeru/core`) that drives the OpenAI Codex CLI via `codex exec --json
 * --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check` mode.
 * See `adapter.ts` for the implementation.
 */

export { createCodexAdapter } from "./adapter.js";
export {
	parseCodexJson,
	parseCodexJsonIncremental,
} from "./stream-parser.js";
export type {
	CodexAdapterOptions,
	CodexParsedResult,
	CodexResultSubtype,
	SpawnArgs,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
	StreamParseEvent,
} from "./types.js";
