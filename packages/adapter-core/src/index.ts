// @sumeru/adapter-core — public entry. Pure re-export barrel.
// Adapter common framework: cli-kit NDJSON stdin/stdout entrypoint.

export {
	type ControlFrameType,
	handleControlFrame,
	type InstallSkillControlValue,
	isControlFrameType,
	type ModelControlValue,
	type ResetControlValue,
} from "./control-frames.js";
export { createAdapterEntry, runAdapterEntry } from "./entrypoint.js";
export type { HarnessConfig } from "./harness-types.js";
export type { SessionLoopOptions } from "./session-loop.js";
export { createSessionLoop, runSessionLoop } from "./session-loop.js";
export type {
	AdapterEntryOptions,
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	AdapterManifest,
	AssistantTurnValue,
	BuiltinModel,
	DoneValue,
	InboundFrame,
	InboxMessage,
	ListModelsFn,
	OutboundFrame,
	OutboxFrame,
	ProviderMode,
	SkillContent,
	SuspendOutboundValue,
	SuspendValue,
	ToolTurnValue,
	TurnValue,
	WireErrorValue,
	WireToolCall,
} from "./types.js";
