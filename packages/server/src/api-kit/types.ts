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

/**
 * Validated request context passed to a generator action. Parameterised by the
 * route params shape and the parsed request body type. Actions receive this
 * after all HTTP-level validation (auth, content-type, body parsing, resource
 * lookup) is complete — they never touch raw req/res.
 */
export type ActionContext<TParams = Record<string, string>, TBody = unknown> = {
	params: TParams;
	body: TBody;
};

/**
 * Middleware for generator-based actions. Wraps an async iterable event source,
 * returning a new iterable that may transform, filter, or augment the yielded
 * events. The context parameter carries per-invocation configuration.
 *
 * Compose by nesting: `mid2(mid1(source, ctx1), ctx2)`.
 */
export type ApiMiddleware<TEvent, TCtx = ActionContext> = (
	source: AsyncIterable<TEvent>,
	ctx: TCtx,
) => AsyncIterable<TEvent>;
