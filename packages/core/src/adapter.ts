/**
 * Adapter contract — the abstraction that sits between `@sumeru/server` and a
 * concrete agent CLI/SDK (Hermes, Claude Code, etc.).
 *
 * Each adapter package (`@sumeru/adapter-hermes`, future
 * `@sumeru/adapter-claude-code`, …) imports `Adapter` from `@sumeru/core` and
 * exports a factory function returning an object that satisfies the contract.
 */

import type { TokenUsage, Turn } from "./types.js";

/**
 * Stable handle for an agent-side session.
 *
 * `nativeId` is the agent's own identifier (e.g. Hermes's
 * `YYYYMMDD_HHMMSS_<hash>`). The Sumeru-managed `ses_…` ID is **never**
 * passed to adapter methods — the server layer translates between the two.
 *
 * `meta` is opaque adapter-specific bookkeeping (cwd, source tag, model, …).
 * Adapters MUST NOT place credentials, tokens, or path-shaped secrets here.
 */
export type NativeSessionRef = {
	nativeId: string;
	meta: Record<string, unknown>;
};

/** Result of a single `Adapter.send` call. */
export type AgentResponse = {
	/** Turns produced by the agent during this `send` call, in order. */
	turns: Turn[];
	/** Aggregated token usage for the call, or null if unreported. */
	tokens: TokenUsage | null;
	/** Wall-clock duration of the call in milliseconds (non-negative integer). */
	durationMs: number;
};

/**
 * Capability flags. Structurally identical to `GatewayCapabilities` in
 * `@sumeru/server` — a server can source `gateway.capabilities` from
 * `adapter.capabilities` without conversion.
 */
export type AdapterCapabilities = {
	resume: boolean;
	streaming: boolean;
};

/**
 * The Adapter contract. All methods are Promise-returning to keep the
 * surface uniform across sync- and async-backed adapters.
 */
export type Adapter = {
	/** Stable adapter name (lower-case kebab), e.g. "hermes", "claude-code". */
	name: string;
	capabilities: AdapterCapabilities;
	createSession(config: Record<string, unknown>): Promise<NativeSessionRef>;
	send(ref: NativeSessionRef, content: string): Promise<AgentResponse>;
	close(ref: NativeSessionRef): Promise<void>;
	getTurns(ref: NativeSessionRef): Promise<Turn[]>;
};
