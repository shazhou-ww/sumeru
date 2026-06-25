import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Handler signature for route callbacks.
 *
 * @param req - Node HTTP request
 * @param res - Node HTTP response
 * @param params - Extracted path parameters (raw, still URL-encoded)
 * @param path - Original path (query-stripped, trailing slash NOT normalized) for error messages
 * @param queryString - Query string portion (empty string if none)
 */
export type RouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
	path: string,
	queryString: string,
) => void;

/**
 * Internal route representation after parsing the pattern.
 */
export type Route = {
	segments: string[];
	paramNames: string[];
	method: string;
	handler: RouteHandler;
};

/**
 * Match result for the router.
 * - match: path and method matched, dispatch to handler
 * - method_not_allowed: path matched but method didn't, return 405
 * - not_found: no path matched, return 404
 */
export type MatchResult =
	| { type: "match"; handler: RouteHandler; params: Record<string, string> }
	| { type: "method_not_allowed"; allow: string }
	| { type: "not_found" };
