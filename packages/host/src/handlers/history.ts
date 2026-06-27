import type { IncomingMessage, ServerResponse } from "node:http";
import { envelope, errorEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { InstanceManager } from "../instance-manager.js";
import type { HistoryValue } from "../types.js";

const DEFAULT_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_LIMIT = 1000;

export function createHistoryHandler(manager: InstanceManager) {
	return (
		_req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
		_path: string,
		queryString: string,
	): void => {
		const id = params.id ?? "";
		const record = manager.getInstance(id);
		if (record === null) {
			writeJson(
				res,
				404,
				errorEnvelope("instance_not_found", "Instance not found"),
			);
			return;
		}

		const query = new URLSearchParams(queryString);
		const limitParsed = parseNonNegativeInt(query.get("limit"), DEFAULT_LIMIT);
		if (limitParsed === null) {
			writeJson(
				res,
				400,
				errorEnvelope(
					"invalid_request",
					`Query parameter 'limit' must be a non-negative integer (got '${query.get("limit") ?? ""}')`,
				),
			);
			return;
		}
		const offsetParsed = parseNonNegativeInt(
			query.get("offset"),
			DEFAULT_OFFSET,
		);
		if (offsetParsed === null) {
			writeJson(
				res,
				400,
				errorEnvelope(
					"invalid_request",
					`Query parameter 'offset' must be a non-negative integer (got '${query.get("offset") ?? ""}')`,
				),
			);
			return;
		}

		const limit = Math.min(limitParsed, MAX_LIMIT);
		const offset = offsetParsed;
		const history = manager.getHistory(id, limit, offset);
		writeJson(res, 200, historyEnvelope(history));
	};
}

export function historyEnvelope(value: HistoryValue) {
	return envelope("@sumeru/history", value);
}

function parseNonNegativeInt(
	raw: string | null,
	defaultValue: number,
): number | null {
	if (raw === null || raw.length === 0) return defaultValue;
	if (!/^\d+$/.test(raw)) return null;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(parsed)) return null;
	return parsed;
}
