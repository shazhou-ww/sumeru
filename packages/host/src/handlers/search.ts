import type { IncomingMessage, ServerResponse } from "node:http";
import type { InstanceId } from "@sumeru/core";
import { envelope, errorEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import { createSearchIndex, type SearchHit } from "../search.js";

export type SearchValue = {
	query: string;
	hits: Array<SearchHit>;
};

export function createSearchHandler(dataDir: string) {
	return (
		_req: IncomingMessage,
		res: ServerResponse,
		_params: Record<string, string>,
		_path: string,
		queryString: string,
	): void => {
		const query = new URLSearchParams(queryString);
		const q = query.get("q");
		if (q === null || q.trim().length === 0) {
			writeJson(
				res,
				400,
				errorEnvelope("invalid_request", "Query parameter 'q' is required"),
			);
			return;
		}

		const instanceRaw = query.get("instance");
		const instanceFilter = parseInstanceFilter(instanceRaw);
		if (instanceFilter === undefined) {
			writeJson(
				res,
				400,
				errorEnvelope(
					"invalid_request",
					"Query parameter 'instance' must be a non-empty string when provided",
				),
			);
			return;
		}

		const index = createSearchIndex(dataDir);
		const hits = index.search(q, instanceFilter);
		writeJson(res, 200, searchEnvelope({ query: q, hits }));
	};
}

export function searchEnvelope(value: SearchValue) {
	return envelope("@sumeru/search", value);
}

function parseInstanceFilter(
	raw: string | null,
): InstanceId | null | undefined {
	if (raw === null || raw.length === 0) return null;
	if (raw.trim().length === 0) return undefined;
	return raw;
}
