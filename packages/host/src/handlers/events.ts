import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope } from "../envelope.js";
import {
	writeJson,
	writeRawSseEvent,
	writeSseComment,
	writeSseHeaders,
} from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function createEventsHandler(manager: SessionManager) {
	return (
		req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
	): void => {
		const id = params.id ?? "";
		const lastEventId = parseLastEventId(req);

		let buffer: ReturnType<SessionManager["getSseBuffer"]>;
		try {
			buffer = manager.getSseBuffer(id);
		} catch (err) {
			writeEventsSubscribeError(res, err);
			return;
		}

		if (lastEventId !== null && buffer.isExpired(lastEventId)) {
			writeJson(
				res,
				410,
				errorEnvelope(
					"sse_buffer_expired",
					"Last-Event-ID is no longer in the replay buffer",
				),
			);
			return;
		}

		writeSseHeaders(res);
		res.socket?.setNoDelay(true);

		const replayFrom = lastEventId ?? 0;
		let watermark = replayFrom;
		const replayEvents = buffer.eventsAfter(replayFrom);
		for (const evt of replayEvents) {
			writeRawSseEvent(res, evt);
			watermark = evt.id;
		}

		// If the last replayed event is an exit and there's nothing more coming
		// (buffer caught up), close the connection.
		const lastReplayed = replayEvents[replayEvents.length - 1];
		if (
			lastReplayed !== undefined &&
			lastReplayed.event === "exit" &&
			lastReplayed.id >= buffer.latest()
		) {
			res.end();
			return;
		}

		let unsubscribe: (() => void) | null = null;
		let heartbeatTimer: NodeJS.Timeout | null = null;

		const cleanup = (): void => {
			if (unsubscribe !== null) unsubscribe();
			if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
		};

		const onClose = (): void => {
			cleanup();
		};
		req.on("close", onClose);

		heartbeatTimer = setInterval(() => {
			if (res.writableEnded) {
				cleanup();
				return;
			}
			writeSseComment(res);
		}, HEARTBEAT_INTERVAL_MS);

		try {
			unsubscribe = manager.subscribeEvents(id, (evt) => {
				if (evt.id <= watermark) return;
				watermark = evt.id;
				writeRawSseEvent(res, evt);
				if (evt.event === "exit") {
					res.end();
					cleanup();
				}
			});
		} catch (err) {
			cleanup();
			writeEventsSubscribeError(res, err);
		}
	};
}

function parseLastEventId(req: IncomingMessage): number | null {
	const raw = req.headers["last-event-id"];
	if (raw === undefined) return null;
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === undefined || value.trim().length === 0) return null;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}

function writeEventsSubscribeError(res: ServerResponse, err: unknown): void {
	if (res.headersSent) {
		const message = err instanceof Error ? err.message : String(err);
		writeRawSseEvent(res, {
			id: 0,
			event: "exit",
			data: JSON.stringify({
				type: "failed",
				message,
				elapsedMs: 0,
				turnCount: 0,
				tokenUsage: { input: 0, output: 0, cached: 0 },
			}),
		});
		res.end();
		return;
	}
	const message = err instanceof Error ? err.message : String(err);
	switch (message) {
		case "session_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("session_not_found", "Session not found"),
			);
			return;
		default:
			writeJson(res, 500, errorEnvelope("internal_error", message));
	}
}
