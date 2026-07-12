// @sumeru/adapter-core — adapter-author contract + NDJSON wire-frame types.
// Authoritative source: package-design wiki §4 "@sumeru/adapter-core — Adapter 公共框架".
// Wire payload types live in wire-types.ts; ModelConfig comes from @sumeru/core.

import type { ModelConfig } from "@sumeru/core";
import type {
	DoneValue,
	InboxMessage,
	SuspendValue,
	TurnValue,
	WireErrorValue,
} from "./wire-types.js";

export type {
	AssistantTurnValue,
	DoneValue,
	InboxMessage,
	OutboxFrame,
	SuspendValue,
	ToolTurnValue,
	TurnValue,
	WireErrorValue,
	WireToolCall,
} from "./wire-types.js";

// === Adapter-author contract ===

// A single skill made available to the adapter at init time.
export type SkillContent = {
	name: string;
	content: string;
};

// The config delivered on the first stdin line ({ type: "init" }).
// No workdir/cwd: HOME is fixed; working directory is carried per-message
// via InboxMessage.project.
export type AdapterInitConfig = {
	instructions: string;
	skills: Array<SkillContent>;
	model: ModelConfig;
};

// Inbox payload on the wire. Container = session, so no resume hint needed —
// the agent CLI inside the container auto-resumes its only session.
export type AdapterInboxMessage = InboxMessage;

// Yield from `handle`: streaming turns, or an impl-initiated suspend checkpoint.
export type AdapterHandleYield =
	| TurnValue
	| { type: "suspend"; value: SuspendValue };

// The contract an adapter author implements. `handle` is an AsyncGenerator
// whose yield type is AdapterHandleYield and whose return type is DoneValue.
export type AdapterImpl = {
	init(config: AdapterInitConfig): Promise<void>;
	handle(
		message: AdapterInboxMessage,
	): AsyncGenerator<AdapterHandleYield, DoneValue>;
	// Optional: restore persisted state before the init handshake (adapter restart).
	resume?: () => boolean | Promise<boolean>;
	// Optional: expose the agent-native session id for timeout suspend + resume.
	getNativeId?: () => string | null;
};

// === Adapter manifest (static capability declaration) ===

// How an adapter obtains LLM access.
//   custom-only  — no built-in provider; user must configure Provider + Model
//                  entities (e.g. sarsapa).
//   both         — has a built-in provider but can also point to a custom one
//                  (e.g. claude-code, codex).
//   builtin-only — only uses the platform's built-in provider; Provider/Model
//                  entities are not needed (e.g. cursor-agent, hermes).
export type ProviderMode = "custom-only" | "both" | "builtin-only";

// Result of listing built-in models from a platform API.
export type BuiltinModel = {
	id: string;
	name: string;
	contextWindow: number | null;
};

// Function that an adapter implements to list its platform's available models.
// Called with the platform credential (from credentialEnv).
// Throws on API error; host catches and returns 502.
export type ListModelsFn = (credential: string) => Promise<Array<BuiltinModel>>;

// Static manifest exported by each adapter package. Declares the adapter's
// capabilities so the Host can validate prototype configs and skip
// unnecessary Provider/Model lookups for builtin-only adapters.
export type AdapterManifest = {
	name: string;
	providerMode: ProviderMode;
	// Env var that carries the platform credential (e.g. "CURSOR_API_KEY").
	// Required for builtin-only and both; omitted for custom-only.
	credentialEnv: string | null;
	// Function to list built-in models, or null if not supported.
	listModels: ListModelsFn | null;
};

// === NDJSON wire frames ===

// Inbound frames read from stdin (discriminated union on `type`).
export type InboundFrame =
	| { type: "init"; value: AdapterInitConfig }
	| { type: "message"; value: AdapterInboxMessage };

// Outbound frames written to stdout (discriminated union on `type`).
// `ready` is local to adapter-core; turn/done/suspend/error reuse wire-types.
export type SuspendOutboundValue = SuspendValue & {
	nativeId: string | null;
};

export type OutboundFrame =
	| { type: "ready"; value: Record<string, never> }
	| { type: "turn"; value: TurnValue }
	| { type: "done"; value: DoneValue }
	| { type: "suspend"; value: SuspendOutboundValue }
	| { type: "error"; value: WireErrorValue };

// === Entrypoint run options (injectable I/O seam for unit testing) ===

// The stdin/stdout seam + optional signal hook so the entrypoint is testable
// without spawning a child process or sending real OS signals.
export type AdapterEntryOptions = {
	impl: AdapterImpl;
	stdin: NodeJS.ReadableStream;
	stdout: NodeJS.WritableStream;
	// Registers a SIGTERM-style shutdown hook; returns a disposer that removes it.
	// Defaults to a real process.on("SIGTERM", ...) registration.
	onSigterm: (handler: () => void) => () => void;
	// Wall-clock limit for a single handle() invocation (null = default 2 h).
	sendTimeoutMs: number | null;
};
