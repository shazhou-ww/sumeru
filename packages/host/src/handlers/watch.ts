import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope } from "../envelope.js";
import {
	writeJson,
	writeRawSseEvent,
	writeSseComment,
	writeSseEvent,
	writeSseHeaders,
} from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function createWatchHandler(manager: SessionManager) {
	return (
		req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
	): void => {
		const id = params.id ?? "";
		const session = manager.getSession(id);
		if (session === null) {
			writeJson(
				res,
				404,
				errorEnvelope("session_not_found", "Session not found"),
			);
			return;
		}

		writeSseHeaders(res);
		res.flushHeaders();
		res.socket?.setNoDelay(true);
		writeSseEvent(res, "connected", { ts: new Date().toISOString() });

		let unsubscribe: (() => void) | null = null;
		let heartbeatTimer: NodeJS.Timeout | null = null;

		const cleanup = (): void => {
			if (unsubscribe !== null) unsubscribe();
			if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
		};

		req.on("close", cleanup);

		heartbeatTimer = setInterval(() => {
			if (res.writableEnded) {
				cleanup();
				return;
			}
			writeSseComment(res);
		}, HEARTBEAT_INTERVAL_MS);

		unsubscribe = manager.subscribeEvents(id, (evt) => {
			if (res.writableEnded) return;
			if (evt.event !== "turn" && evt.event !== "exit") return;
			writeRawSseEvent(res, evt);
		});
	};
}
