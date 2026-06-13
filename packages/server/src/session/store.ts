import type { Session, SessionConfig, SessionStatus } from "../types.js";
import { generateSessionId } from "./id.js";

/**
 * In-memory session store.
 *
 * Phase 2: persistence is per-process and lost on restart. Adapter-level
 * persistence lands in a later phase when the message endpoint is wired up.
 *
 * Sessions are scoped to their gateway: lookups always include the gateway
 * name, and a session created on `hermes` is invisible from `claude-code`.
 *
 * The store is a closure over a `Map<gateway, Map<id, Session>>`. Insertion
 * order is preserved on the inner maps, which makes listings deterministic
 * (chronological by createdAt ascending).
 */

export type SessionStore = {
	/** Create a new session on `gateway`. The id is generated server-side. */
	create: (gateway: string, config: SessionConfig) => Session;
	/** List sessions on a gateway in insertion order (chronological). */
	list: (gateway: string) => Session[];
	/** Look up a single session, scoped by gateway. */
	get: (gateway: string, id: string) => Session | null;
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

/** Build a fresh, empty session store. */
export function createSessionStore(): SessionStore {
	const byGateway = new Map<string, Map<string, Session>>();

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

	function create(gateway: string, config: SessionConfig): Session {
		const inner = ensureGatewayMap(gateway);
		const session: Session = {
			id: generateSessionId(),
			gateway,
			status: "idle",
			createdAt: nowIso(),
			config,
		};
		inner.set(session.id, session);
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

	function close(
		gateway: string,
		id: string,
	): "closed" | "already_closed" | "not_found" {
		const session = get(gateway, id);
		if (session === null) return "not_found";
		if (session.status === "closed") return "already_closed";
		session.status = "closed";
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
