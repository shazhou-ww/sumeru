import type { Hash } from "@ocas/core";
import type { NativeSessionRef } from "@sumeru/core";
import { recordPayload } from "../ocas/index.js";
import type {
	OcasConfig,
	Session,
	SessionConfig,
	SessionStatus,
	SessionWire,
} from "../types.js";
import { generateSessionId } from "./id.js";

/**
 * In-memory session store.
 *
 * Phase 2: persistence is per-process and lost on restart. Adapter-level
 * persistence lands in a later phase when the message endpoint is wired up.
 *
 * Phase 3: each session also tracks an internal `NativeSessionRef` produced
 * by the adapter when the session was created. The `NativeSessionRef` is
 * NEVER exposed in HTTP envelopes — only `getNativeRef` makes it visible
 * to internal callers (the message handler, the close path).
 *
 * Phase 4: each session carries a `metaHash` (set on create) and a
 * `turnHashes` array that grows as turns are recorded. Both are internal
 * — they are NEVER serialized into HTTP envelopes; `toWire` strips them.
 *
 * Sessions are scoped to their gateway: lookups always include the gateway
 * name, and a session created on `hermes` is invisible from `claude-code`.
 *
 * The store is a closure over a `Map<gateway, Map<id, Session>>`. Insertion
 * order is preserved on the inner maps, which makes listings deterministic
 * (chronological by createdAt ascending).
 */

export type SessionStore = {
	/**
	 * Create a new session on `gateway`. The id is generated server-side.
	 * Writes the corresponding `@sumeru/session-meta` node to ocas BEFORE
	 * the in-memory session is registered. Throws if the meta-write fails.
	 *
	 * `resolvedCwd` is the absolute path produced by `resolveSessionCwd`
	 * (issue #27) — the value the server already forwarded to the adapter
	 * under `config.cwd`. `null` means no cwd hint was supplied. The opaque
	 * `config` blob is preserved verbatim and is NOT mutated here.
	 */
	create: (
		gateway: string,
		adapter: string,
		config: SessionConfig,
		nativeRef: NativeSessionRef | null,
		resolvedCwd: string | null,
	) => Session;
	/** List sessions on a gateway in insertion order (chronological). */
	list: (gateway: string) => Session[];
	/** Look up a single session, scoped by gateway. */
	get: (gateway: string, id: string) => Session | null;
	/** Internal-only: retrieve the NativeSessionRef recorded at create time. */
	getNativeRef: (gateway: string, id: string) => NativeSessionRef | null;
	/**
	 * Append a turn hash to a session's turn list. Used by the message
	 * endpoint as turns are recorded in ocas. No-op if the session is gone.
	 */
	appendTurnHash: (gateway: string, id: string, hash: Hash) => void;
	/**
	 * Mark a session closed. Returns:
	 *   - `closed`         if the status flipped from idle/active to closed
	 *   - `already_closed` if it was already closed (idempotent no-op)
	 *   - `not_found`      if no such session exists on the gateway
	 */
	close: (
		gateway: string,
		id: string,
	) => "closed" | "already_closed" | "not_found";
	/** Number of non-closed sessions on a gateway. */
	activeCount: (gateway: string) => number;
	/**
	 * Try to mark a session active (idle → active). Reserved for the future
	 * message endpoint; exposed now so the 409 contract is testable.
	 */
	tryActivate: (
		gateway: string,
		id: string,
	) => TransitionResult<"busy" | "closed" | "not_found">;
	/**
	 * Mark a session idle (active → idle). Used at the end of a message
	 * exchange. Forward-compat for the message endpoint.
	 */
	markIdle: (
		gateway: string,
		id: string,
	) => TransitionResult<"not_active" | "not_found">;
};

export type TransitionResult<R extends string> =
	| { ok: true; session: Session }
	| { ok: false; reason: R };

/**
 * Strip internal-only fields (`metaHash`, `turnHashes`) from a `Session` so
 * the result matches the HTTP wire envelope.
 */
export function toWire(session: Session): SessionWire {
	return {
		id: session.id,
		gateway: session.gateway,
		status: session.status,
		createdAt: session.createdAt,
		config: session.config,
	};
}

/**
 * Build a fresh, empty session store.
 *
 * The store needs `ocas` so it can write `@sumeru/session-meta` nodes on
 * `create`. The hash is recorded on the in-memory session for later
 * cross-reference by the `/ocas/:hash` endpoint.
 */
export function createSessionStore(ocas: OcasConfig): SessionStore {
	const byGateway = new Map<string, Map<string, Session>>();
	const nativeRefs = new Map<string, NativeSessionRef>();

	function ensureGatewayMap(gateway: string): Map<string, Session> {
		let inner = byGateway.get(gateway);
		if (inner === undefined) {
			inner = new Map();
			byGateway.set(gateway, inner);
		}
		return inner;
	}

	function nowIso(): string {
		return new Date().toISOString();
	}

	function refKey(gateway: string, id: string): string {
		return `${gateway}\u0000${id}`;
	}

	function create(
		gateway: string,
		adapter: string,
		config: SessionConfig,
		nativeRef: NativeSessionRef | null,
		resolvedCwd: string | null,
	): Session {
		const inner = ensureGatewayMap(gateway);
		const id = generateSessionId();
		const createdAt = nowIso();
		// Record session-meta to ocas FIRST. If validation/IO fails, the
		// in-memory session is never created — the caller propagates a 500.
		const metaHash = recordPayload(ocas.store, ocas.sessionMetaSchemaHash, {
			id,
			gateway,
			adapter,
			createdAt,
			config,
			resolvedCwd,
		});
		// Phase 5: seed the search index. Failures here do NOT roll back the
		// ocas write — the index can always be rebuilt from the meta node.
		try {
			ocas.searchIndex.indexSessionMeta({
				sessionId: id,
				gateway,
				adapter,
				createdAt,
			});
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			console.warn(`[sumeru] search index seed failed: ${cause}`);
		}
		const session: Session = {
			id,
			gateway,
			status: "idle",
			createdAt,
			config,
			metaHash,
			turnHashes: [],
		};
		inner.set(session.id, session);
		if (nativeRef !== null) {
			nativeRefs.set(refKey(gateway, session.id), nativeRef);
		}
		return session;
	}

	function list(gateway: string): Session[] {
		const inner = byGateway.get(gateway);
		if (inner === undefined) return [];
		return Array.from(inner.values());
	}

	function get(gateway: string, id: string): Session | null {
		const inner = byGateway.get(gateway);
		if (inner === undefined) return null;
		return inner.get(id) ?? null;
	}

	function getNativeRef(gateway: string, id: string): NativeSessionRef | null {
		return nativeRefs.get(refKey(gateway, id)) ?? null;
	}

	function appendTurnHash(gateway: string, id: string, hash: Hash): void {
		const session = get(gateway, id);
		if (session === null) return;
		session.turnHashes.push(hash);
	}

	function close(
		gateway: string,
		id: string,
	): "closed" | "already_closed" | "not_found" {
		const session = get(gateway, id);
		if (session === null) return "not_found";
		if (session.status === "closed") return "already_closed";
		session.status = "closed";
		// Best-effort: mark the search-index row closed too. Failures are
		// logged inside markSessionClosed; the in-memory flip is the source
		// of truth on the wire.
		ocas.searchIndex.markSessionClosed(id);
		return "closed";
	}

	function activeCount(gateway: string): number {
		const inner = byGateway.get(gateway);
		if (inner === undefined) return 0;
		let n = 0;
		for (const s of inner.values()) {
			if (s.status !== "closed") n += 1;
		}
		return n;
	}

	function tryActivate(
		gateway: string,
		id: string,
	): TransitionResult<"busy" | "closed" | "not_found"> {
		const session = get(gateway, id);
		if (session === null) return { ok: false, reason: "not_found" };
		const next = transitionTo(session.status, "active");
		if (next === "busy" || next === "closed") {
			return { ok: false, reason: next };
		}
		session.status = "active";
		return { ok: true, session };
	}

	function markIdle(
		gateway: string,
		id: string,
	): TransitionResult<"not_active" | "not_found"> {
		const session = get(gateway, id);
		if (session === null) return { ok: false, reason: "not_found" };
		if (session.status !== "active") {
			return { ok: false, reason: "not_active" };
		}
		session.status = "idle";
		return { ok: true, session };
	}

	return {
		create,
		list,
		get,
		getNativeRef,
		appendTurnHash,
		close,
		activeCount,
		tryActivate,
		markIdle,
	};
}

/**
 * Transition table for `tryActivate`-style edges. Returns the literal `"ok"`
 * if the transition is allowed, or a string reason if it is not.
 */
function transitionTo(
	from: SessionStatus,
	to: "active",
): "ok" | "busy" | "closed" {
	if (to === "active") {
		if (from === "idle") return "ok";
		if (from === "active") return "busy";
		return "closed"; // from === "closed"
	}
	// Exhaustive: only "active" is a valid `to` here.
	return "ok";
}
