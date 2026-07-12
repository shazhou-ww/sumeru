import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope, turnListEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";

export function createTurnsHandler(manager: SessionManager) {
	return (
		_req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
		_path: string,
		queryString: string,
	): void => {
		const id = params.id ?? "";
		const record = manager.getSession(id);
		if (record === null) {
			writeJson(
				res,
				404,
				errorEnvelope("session_not_found", "Session not found"),
			);
			return;
		}

		const query = new URLSearchParams(queryString);
		const afterRaw = query.get("after");
		let after: number | null = null;
		if (afterRaw !== null && afterRaw.length > 0) {
			if (!/^\d+$/.test(afterRaw)) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_request",
						`Query parameter 'after' must be a non-negative integer (got '${afterRaw}')`,
					),
				);
				return;
			}
			const parsed = Number.parseInt(afterRaw, 10);
			if (!Number.isSafeInteger(parsed)) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_request",
						`Query parameter 'after' must be a non-negative integer (got '${afterRaw}')`,
					),
				);
				return;
			}
			after = parsed;
		}

		const includeSystem = query.get("system") === "true";

		const beforeRaw = query.get("before");
		let beforeMs: number | null = null;
		if (beforeRaw !== null && beforeRaw.length > 0) {
			const parsed = Date.parse(beforeRaw);
			if (!Number.isFinite(parsed)) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_request",
						`Query parameter 'before' must be an ISO 8601 timestamp (got '${beforeRaw}')`,
					),
				);
				return;
			}
			beforeMs = parsed;
		}

		let turns = manager.getSessionTurns(id, after, { includeSystem });
		if (beforeMs !== null) {
			turns = turns.filter((turn) => Date.parse(turn.timestamp) < beforeMs);
		}
		writeJson(res, 200, turnListEnvelope(turns));
	};
}
