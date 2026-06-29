import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope } from "../envelope.js";
import { writeJson, writeRawSseEvent, writeSseHeaders } from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function createOutboxHandler(manager: SessionManager) {
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
			writeOutboxSubscribeError(res, err);
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
		for (const evt of buffer.eventsAfter(replayFrom)) {
			writeRawSseEvent(res, evt);
			watermark = evt.id;
			if (evt.event === "done" || evt.event === "error") {
				res.end();
				return;
			}
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
			const heartbeat = buffer.append({ event: "heartbeat", data: "{}" });
			writeRawSseEvent(res, heartbeat);
		}, HEARTBEAT_INTERVAL_MS);

		try {
			unsubscribe = manager.subscribeOutbox(id, (evt) => {
				if (evt.id <= watermark) return;
				watermark = evt.id;
				writeRawSseEvent(res, evt);
				if (evt.event === "done" || evt.event === "error") {
					res.end();
					cleanup();
				}
			});
		} catch (err) {
			cleanup();
			writeOutboxSubscribeError(res, err);
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

function writeOutboxSubscribeError(res: ServerResponse, err: unknown): void {
	if (res.headersSent) {
		const message = err instanceof Error ? err.message : String(err);
		writeRawSseEvent(res, {
			id: 0,
			event: "error",
			data: JSON.stringify({
				type: "error",
				value: { code: message, message },
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
