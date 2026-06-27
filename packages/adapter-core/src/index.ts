// @sumeru/adapter-core — public entry. Pure re-export barrel.
// Adapter common framework: cli-kit NDJSON stdin/stdout entrypoint.
export { createAdapterEntry, runAdapterEntry } from "./entrypoint.js";
export type {
	AdapterEntryOptions,
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	InboundFrame,
	OutboundFrame,
	SkillContent,
	SuspendOutboundValue,
} from "./types.js";
