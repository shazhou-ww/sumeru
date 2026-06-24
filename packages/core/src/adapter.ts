/**
 * Adapter contract — the abstraction that sits between `@sumeru/server` and a
 * concrete agent CLI/SDK (Hermes, Claude Code, etc.).
 *
 * Each adapter package (`@sumeru/adapter-hermes`, `@sumeru/adapter-claude-code`,
 * …) imports `Adapter` from `@sumeru/core` and exports a factory function
 * returning an object that satisfies the contract.
 *
 * Streaming-first: `send` returns `AsyncIterable<SendEvent>` so the server can
 * process turns incrementally as the agent produces them — no waiting for the
 * full run to finish before emitting SSE events.
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

/**
 * Configuration passed to `Adapter.createSession`. The adapter uses these to
 * spawn the agent process — `model` selects the LLM, `cwd` sets the working
 * directory. Both are nullable (adapter picks its own defaults when null).
 */
export type SessionConfig = {
	model: string | null;
	cwd: string | null;
};

/**
 * Events yielded by `Adapter.send` as the agent runs:
 *
 * - `turn`    — a single turn produced by the agent.
 * - `done`    — terminal: signals completion with wall-clock duration and optional token usage.
 * - `suspend` — terminal: the send was interrupted (currently only by `reason: "timeout"`)
 *               and may be resumed later via the carried `nativeId`. The agent process has
 *               already been killed; `elapsedMs` is how long the killed send ran. A peer of
 *               `done`/`error` (NOT of `turn`): once yielded, the stream terminates.
 * - `error`   — terminal: signals an adapter-level error; terminates the stream.
 */
export type SendEvent =
	| { type: "turn"; turn: Turn }
	| { type: "done"; durationMs: number; tokens: TokenUsage | null }
	| { type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }
	| { type: "error"; error: Error };

/**
 * The Adapter contract. All methods are Promise-returning (or AsyncIterable)
 * to keep the surface uniform across sync- and async-backed adapters.
 */
export type Adapter = {
	/** Stable adapter name (lower-case kebab), e.g. "hermes", "claude-code". */
	name: string;
	createSession(config: SessionConfig): Promise<NativeSessionRef>;
	send(ref: NativeSessionRef, content: string): AsyncIterable<SendEvent>;
	close(ref: NativeSessionRef): Promise<void>;
	getTurns(ref: NativeSessionRef): Promise<Turn[]>;
};
