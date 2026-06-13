/**
 * @sumeru/server — HTTP service for the Sumeru observation lab.
 *
 * Phase 1: configuration-driven instance + gateway endpoints.
 * Phase 2: session lifecycle endpoints (create / list / detail / delete).
 * Phase 3: adapter integration + SSE message endpoint.
 * All responses follow the ocas envelope: { type, value }.
 */

import type { Adapter, NativeSessionRef, Turn } from "@sumeru/core";

// ─── Envelope ────────────────────────────────────────────

/** Generic ocas-style envelope. Every HTTP response body uses this shape. */
export type Envelope<T> = {
	type: string;
	value: T;
};

// ─── Session ─────────────────────────────────────────────

/**
 * Session status state machine:
 *   (none) → idle              on POST /gateways/:name/sessions
 *   idle  → active             on send-start (future POST .../messages)
 *   active → idle              on send-finish
 *   idle  → closed             on DELETE /gateways/:name/sessions/:id
 *   active → closed            on DELETE while active (Phase 3+)
 *   closed → closed            idempotent DELETE no-op
 *
 * No other transitions are permitted.
 */
export type SessionStatus = "idle" | "active" | "closed";

/** Opaque adapter-specific config blob — Sumeru does not validate or normalize. */
export type SessionConfig = Record<string, unknown>;

/** Full session shape returned by POST 201 and GET /gateways/:name/sessions/:id. */
export type Session = {
	id: string;
	gateway: string;
	status: SessionStatus;
	createdAt: string;
	config: SessionConfig;
};

/** Compact list entry — `config` is omitted to keep listings small. */
export type SessionListEntry = {
	id: string;
	gateway: string;
	status: SessionStatus;
	createdAt: string;
};

// ─── Turn / SSE values (Phase 3) ─────────────────────────

/** Body shape for POST .../messages. */
export type MessageRequest = {
	content: string;
};

/** SSE done-event payload. */
export type SummaryValue = {
	turnCount: number;
	tokens: { in: number; out: number } | null;
	durationMs: number;
};

/** SSE heartbeat-event payload. */
export type HeartbeatValue = {
	elapsed: number;
};

/** SSE turn-event payload re-uses Turn from @sumeru/core. */
export type TurnValue = Turn;

// ─── Config (Phase 1) ────────────────────────────────────

/** Capability flags for a gateway. Both fields are required booleans. */
export type GatewayCapabilities = {
	resume: boolean;
	streaming: boolean;
};

/** A single gateway entry inside the parsed `sumeru.yaml`. */
export type GatewayConfig = {
	adapter: string;
	capabilities: GatewayCapabilities;
};

/** Parsed `sumeru.yaml`. Order of `gateways` keys is preserved. */
export type InstanceConfig = {
	name: string;
	gateways: Record<string, GatewayConfig>;
};

// ─── Instance ────────────────────────────────────────────

/** The instance value returned by `GET /`. */
export type Instance = {
	name: string;
	version: string;
	gateways: string[];
};

/**
 * A registered gateway, as returned by `GET /gateways` and `GET /gateways/:name`.
 *
 * `status` is `"ready"` when an adapter is registered for the gateway, or
 * `"unavailable"` when no adapter is wired up. `activeSessions` is the count
 * of non-closed (idle + active) sessions on the gateway.
 */
export type Gateway = {
	name: string;
	adapter: string;
	status: string;
	activeSessions: number;
	capabilities: GatewayCapabilities;
};

// ─── Errors ──────────────────────────────────────────────

/** Error body shape, wrapped in `{ type: "@sumeru/error", value }`. */
export type ErrorValue = {
	error: string;
	message: string;
};

// ─── Server ──────────────────────────────────────────────

/** Configuration for `createHandler`. */
export type ServerConfig = {
	name: string;
	version: string;
	gateways: Record<string, GatewayConfig>;
	/**
	 * Adapter registry, keyed by adapter name (e.g. "hermes"). Adapters not
	 * present here render their gateway as `status: "unavailable"`.
	 */
	adapters: Record<string, Adapter>;
	/** SSE heartbeat interval (ms). Default 15_000. */
	sseHeartbeatMs: number;
	/** Per-send ring buffer size for resume support. Default 1024. */
	sseBufferSize: number;
	/** Retention after `event: done` for resume (ms). Default 30_000. */
	sseRetentionMs: number;
};

/** Configuration for `startServer`. */
export type StartConfig = {
	port: number;
	host: string;
	name: string;
	version: string;
	gateways: Record<string, GatewayConfig>;
	/** Optional adapter registry. Default: `{}` (all gateways unavailable). */
	adapters: Record<string, Adapter> | null;
	/** Optional SSE heartbeat interval (ms). */
	sseHeartbeatMs: number | null;
	/** Optional ring buffer size. */
	sseBufferSize: number | null;
	/** Optional retention after done (ms). */
	sseRetentionMs: number | null;
};

/** Result of `startServer`: the bound address and a stop function. */
export type StartedServer = {
	port: number;
	host: string;
	stop: () => Promise<void>;
};

// ─── Adapter re-exports for convenience ──────────────────

export type { Adapter, NativeSessionRef };
