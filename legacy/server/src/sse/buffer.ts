/**
 * Per-send in-memory ring buffer for SSE resume support.
 *
 * Each `POST /gateways/:name/sessions/:id/messages` call creates a fresh
 * buffer keyed by `(gateway, sessionId, sendNonce)`. Events are appended in
 * id order; the most-recent N events are retained (N = `sseBufferSize`,
 * default 1024). After `event: done` the buffer is held for `retentionMs`
 * (default 30_000) to allow late clients to resume.
 *
 * Resume is a pure replay — `adapter.send` is NOT called twice. The buffer
 * is the canonical record of what the original send produced.
 */

export type SseEvent = {
	id: number;
	event: string;
	/** Stringified data line — already JSON-serialized envelope. */
	data: string;
};

export type SseBuffer = {
	gateway: string;
	sessionId: string;
	nonce: string;
	events: SseEvent[];
	maxId: number;
	doneAt: number | null;
	maxSize: number;
	/** Resolved when the underlying send is finished (success or failure). */
	finished: boolean;
};

export type SseBufferStore = {
	create: (gateway: string, sessionId: string) => SseBuffer;
	getLatestForSession: (gateway: string, sessionId: string) => SseBuffer | null;
	finish: (buf: SseBuffer) => void;
	purgeExpired: (now: number) => void;
	wasRecentlyExpired: (gateway: string, sessionId: string) => boolean;
};

export type SseBufferOptions = {
	maxSize: number;
	retentionMs: number;
};

let nonceCounter = 0;

function nextNonce(): string {
	nonceCounter += 1;
	return `n${Date.now().toString(36)}_${nonceCounter}`;
}

export function createSseBufferStore(
	options: SseBufferOptions,
): SseBufferStore {
	// One buffer per (gateway, sessionId, nonce). We retain the most recent
	// completed buffer per session so an empty-body Last-Event-ID resume can
	// find it for a short window.
	const all = new Map<string, SseBuffer>();
	const latestBySession = new Map<string, string>();

	// Ghost set: tracks recently-expired session keys so resume can
	// distinguish "expired" (410) from "never existed" (404). Entries are
	// pruned when older than retentionMs past their expiry time.
	const recentlyExpired = new Map<string, number>();

	function key(buf: SseBuffer): string {
		return `${buf.gateway}\u0000${buf.sessionId}\u0000${buf.nonce}`;
	}

	function sessionKey(gateway: string, sessionId: string): string {
		return `${gateway}\u0000${sessionId}`;
	}

	function create(gateway: string, sessionId: string): SseBuffer {
		const buf: SseBuffer = {
			gateway,
			sessionId,
			nonce: nextNonce(),
			events: [],
			maxId: 0,
			doneAt: null,
			maxSize: options.maxSize,
			finished: false,
		};
		all.set(key(buf), buf);
		latestBySession.set(sessionKey(gateway, sessionId), key(buf));
		return buf;
	}

	function getLatestForSession(
		gateway: string,
		sessionId: string,
	): SseBuffer | null {
		const k = latestBySession.get(sessionKey(gateway, sessionId));
		if (k === undefined) return null;
		return all.get(k) ?? null;
	}

	function finish(buf: SseBuffer): void {
		buf.finished = true;
		buf.doneAt = Date.now();
	}

	function purgeExpired(now: number): void {
		// First, prune ghost entries older than retentionMs past their expiry.
		for (const [skey, expiredAt] of recentlyExpired) {
			if (now - expiredAt > options.retentionMs) {
				recentlyExpired.delete(skey);
			}
		}
		// Then, move expired live buffers to the ghost set before deleting.
		for (const [k, buf] of all) {
			if (buf.doneAt !== null && now - buf.doneAt > options.retentionMs) {
				const skey = sessionKey(buf.gateway, buf.sessionId);
				recentlyExpired.set(skey, now);
				all.delete(k);
				if (latestBySession.get(skey) === k) {
					latestBySession.delete(skey);
				}
			}
		}
	}

	function wasRecentlyExpired(gateway: string, sessionId: string): boolean {
		return recentlyExpired.has(sessionKey(gateway, sessionId));
	}

	return {
		create,
		getLatestForSession,
		finish,
		purgeExpired,
		wasRecentlyExpired,
	};
}

/** Append an event to a buffer, maintaining `maxSize` ring semantics. */
export function appendEvent(
	buf: SseBuffer,
	event: string,
	data: string,
): SseEvent {
	const id = buf.maxId + 1;
	buf.maxId = id;
	const evt: SseEvent = { id, event, data };
	buf.events.push(evt);
	if (buf.events.length > buf.maxSize) {
		buf.events.shift();
	}
	return evt;
}

/** Wire-format an event: `id: ...\nevent: ...\ndata: ...\n\n`. */
export function formatEvent(evt: SseEvent): string {
	return `id: ${evt.id}\nevent: ${evt.event}\ndata: ${evt.data}\n\n`;
}

/** Range-replay events whose id is strictly greater than `since`. */
export function eventsAfter(buf: SseBuffer, since: number): SseEvent[] {
	if (since < 0) return buf.events.slice();
	return buf.events.filter((e) => e.id > since);
}

/**
 * Lowest still-buffered event id, or 0 when empty. Useful when computing
 * whether a Last-Event-ID predates the ring's current window.
 */
export function lowestId(buf: SseBuffer): number {
	if (buf.events.length === 0) return 0;
	return buf.events[0]?.id ?? 0;
}
