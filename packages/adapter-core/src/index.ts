// @sumeru/adapter-core — public entry. Pure re-export barrel.
// Adapter common framework: cli-kit NDJSON stdin/stdout entrypoint.
export { createAdapterEntry, runAdapterEntry } from "./entrypoint.js";
export type {
	AdapterEntryOptions,
	AdapterImpl,
	AdapterInitConfig,
	InboundFrame,
	OutboundFrame,
	SkillContent,
} from "./types.js";
