// @sumeru/adapter-core — adapter-author contract + NDJSON wire-frame types.
// Authoritative source: package-design wiki §4 "@sumeru/adapter-core — Adapter 公共框架".
// Payload types are imported from @sumeru/core (NOT redefined here).

import type {
	DoneValue,
	ErrorValue,
	InboxMessage,
	ModelConfig,
	TurnValue,
} from "@sumeru/core";

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

// The contract an adapter author implements. `handle` is an AsyncGenerator
// whose yield type is TurnValue and whose return type is DoneValue.
export type AdapterImpl = {
	init(config: AdapterInitConfig): Promise<void>;
	handle(message: InboxMessage): AsyncGenerator<TurnValue, DoneValue>;
};

// === NDJSON wire frames ===

// Inbound frames read from stdin (discriminated union on `type`).
export type InboundFrame =
	| { type: "init"; value: AdapterInitConfig }
	| { type: "message"; value: InboxMessage };

// Outbound frames written to stdout (discriminated union on `type`).
// `ready` is local to adapter-core (core's OutboxFrame has no `ready` member);
// `turn`/`done`/`error` reuse the payload types from @sumeru/core.
export type OutboundFrame =
	| { type: "ready"; value: Record<string, never> }
	| { type: "turn"; value: TurnValue }
	| { type: "done"; value: DoneValue }
	| { type: "error"; value: ErrorValue };

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
};
