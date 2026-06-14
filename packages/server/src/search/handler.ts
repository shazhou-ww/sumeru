/**
 * Phase 5 — search HTTP handlers.
 *
 * Wired into `createHandler` so:
 *   - `GET /sessions?q=...`                    runs cross-gateway search
 *   - `GET /gateways/:name/sessions?q=...`     runs per-gateway search
 *
 * When `q` is missing or empty after trimming, the per-gateway route falls
 * back to the existing `@sumeru/session-list` behavior; the top-level route
 * 400s because there is no listing fallback.
 */

import type { ServerResponse } from "node:http";
import { errorEnvelope, searchResultEnvelope } from "../envelope.js";
import type { SearchIndex } from "../search/index.js";
import type { SearchResultHit, SearchResultValue } from "../types.js";

/** Default limit when `?limit=` is absent. */
const DEFAULT_LIMIT = 50;
/** Hard cap on `?limit=` per spec. */
const LIMIT_CAP = 100;
/** Hard cap on `?q=` length to keep FTS5 inputs and log lines bounded. */
const QUERY_MAX = 1024;

/** Result of parsing the query string for a search request. */
export type ParsedSearchParams =
	| { ok: true; value: ParsedSearchParamsOk }
	| { ok: false; status: 400; error: string; message: string };

export type ParsedSearchParamsOk = {
	/** Trimmed query. Always non-empty when `ok === true`. */
	query: string;
	/** When `null`, the request is for the top-level (cross-gateway) route OR no filter applied. */
	gateway: string | null;
	limit: number;
	offset: number;
};

/**
 * Parse `q`, `limit`, `offset`, and (top-level only) `gateway` from a query
 * string. Trimming `q` to empty is treated as "absent" — the caller decides
 * whether that means fall through to listing or 400.
 */
export function parseSearchParams(
	queryString: string,
	allowGatewayFilter: boolean,
): ParsedSearchParams {
	const params = new URLSearchParams(queryString);
	const rawQ = params.get("q");
	const trimmed = rawQ === null ? "" : rawQ.trim();
	if (trimmed.length === 0) {
		return {
			ok: false,
			status: 400,
			error: "invalid_request",
			message: "Query parameter 'q' is required and must be a non-empty string",
		};
	}
	if (trimmed.length > QUERY_MAX) {
		return {
			ok: false,
			status: 400,
			error: "invalid_request",
			message: `Query parameter 'q' must be at most ${QUERY_MAX} characters`,
		};
	}
	const limitRes = parsePositiveOrEmpty(params.get("limit"), "limit");
	if (!limitRes.ok) {
		return {
			ok: false,
			status: 400,
			error: "invalid_request",
			message: limitRes.message,
		};
	}
	const offsetRes = parseNonNegOrEmpty(params.get("offset"), "offset");
	if (!offsetRes.ok) {
		return {
			ok: false,
			status: 400,
			error: "invalid_request",
			message: offsetRes.message,
		};
	}
	const gatewayRaw = params.get("gateway");
	const gateway =
		allowGatewayFilter && gatewayRaw !== null && gatewayRaw.length > 0
			? gatewayRaw
			: null;
	const limit = limitRes.value === null ? DEFAULT_LIMIT : limitRes.value;
	const offset = offsetRes.value === null ? 0 : offsetRes.value;
	return {
		ok: true,
		value: {
			query: trimmed,
			gateway,
			limit: Math.min(limit, LIMIT_CAP),
			offset,
		},
	};
}

/** Helper that returns `null` for absent params, otherwise a non-negative int. */
function parseNonNegOrEmpty(
	raw: string | null,
	name: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
	if (raw === null) return { ok: true, value: null };
	const trimmed = raw.trim();
	if (trimmed.length === 0 || !/^[0-9]+$/.test(trimmed)) {
		return {
			ok: false,
			message: `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
		};
	}
	const n = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(n) || n < 0) {
		return {
			ok: false,
			message: `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
		};
	}
	return { ok: true, value: n };
}

/** `?limit=` accepts non-negative integers; spec phrasing matches history endpoint. */
function parsePositiveOrEmpty(
	raw: string | null,
	name: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
	return parseNonNegOrEmpty(raw, name);
}

/**
 * Run a cross-gateway search and write the response. Caller must have
 * already validated method == GET / HEAD.
 */
export function handleSearchTopLevel(
	res: ServerResponse,
	queryString: string,
	searchIndex: SearchIndex,
): void {
	const parsed = parseSearchParams(queryString, /* allowGatewayFilter */ true);
	if (!parsed.ok) {
		writeJson(res, parsed.status, errorEnvelope(parsed.error, parsed.message));
		return;
	}
	runAndWrite(res, parsed.value, searchIndex, parsed.value.gateway);
}

/**
 * Run a per-gateway search and write the response. The route's gateway is
 * authoritative; any `?gateway=` param is ignored (per spec).
 */
export function handleSearchPerGateway(
	res: ServerResponse,
	queryString: string,
	searchIndex: SearchIndex,
	gateway: string,
): void {
	// `allowGatewayFilter: false` so `?gateway=...` never overrides the path.
	const parsed = parseSearchParams(queryString, /* allowGatewayFilter */ false);
	if (!parsed.ok) {
		writeJson(res, parsed.status, errorEnvelope(parsed.error, parsed.message));
		return;
	}
	runAndWrite(res, parsed.value, searchIndex, gateway);
}

/**
 * Detect whether a query string carries a search request (`?q=` non-empty
 * after trimming). Used by the per-gateway sessions route to decide between
 * the Phase-2 listing and Phase-5 search.
 */
export function isSearchRequest(queryString: string): boolean {
	const params = new URLSearchParams(queryString);
	const rawQ = params.get("q");
	if (rawQ === null) return false;
	return rawQ.trim().length > 0;
}

function runAndWrite(
	res: ServerResponse,
	parsed: ParsedSearchParamsOk,
	searchIndex: SearchIndex,
	gateway: string | null,
): void {
	const result = searchIndex.search({
		query: parsed.query,
		gateway,
		limit: parsed.limit,
		offset: parsed.offset,
		stripHighlights: false,
	});
	const hits: SearchResultHit[] = result.results.map((r) => ({
		id: r.id,
		gateway: r.gateway,
		status: r.status,
		relevance: r.relevance,
		matchContext: r.matchContext,
		turns: r.turns,
		lastActiveAt: r.lastActiveAt,
	}));
	const value: SearchResultValue = {
		query: parsed.query,
		gateway,
		total: result.total,
		offset: parsed.offset,
		limit: parsed.limit,
		results: hits,
	};
	const payload = JSON.stringify(searchResultEnvelope(value));
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}
