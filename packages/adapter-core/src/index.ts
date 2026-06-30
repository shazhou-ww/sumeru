// @sumeru/adapter-core — public entry. Pure re-export barrel.
// Adapter common framework: cli-kit NDJSON stdin/stdout entrypoint.
export { createAdapterEntry, runAdapterEntry } from "./entrypoint.js";
export type {
	AdapterEntryOptions,
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	AssistantTurnValue,
	DoneValue,
	InboundFrame,
	InboxMessage,
	OutboundFrame,
	OutboxFrame,
	SkillContent,
	SuspendOutboundValue,
	SuspendValue,
	ToolTurnValue,
	TurnValue,
	WireErrorValue,
	WireToolCall,
} from "./types.js";
