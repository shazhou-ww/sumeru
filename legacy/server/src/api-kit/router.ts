import type { IncomingMessage, ServerResponse } from "node:http";
import type { MatchResult, Route, RouteHandler } from "./types.js";

/**
 * Minimal declarative router for sumeru.
 *
 * Supports only static segments + `:param` placeholders via split("/").
 * NO regex, NO wildcards, NO priority, NO nested routers.
 */
export type Api = {
	route: (method: string, pattern: string, handler: RouteHandler) => Api;
	handle: (req: IncomingMessage, res: ServerResponse) => void;
	match: (method: string, path: string) => MatchResult;
};

export function createAPI(options: {
	methodNotAllowed: (
		res: ServerResponse,
		method: string,
		path: string,
		allow: string,
	) => void;
	notFound: (res: ServerResponse, method: string, path: string) => void;
}): Api {
	const routesBySegmentCount = new Map<number, Route[]>();

	function parsePattern(pattern: string): {
		segments: string[];
		paramNames: string[];
	} {
		const segments = pattern.split("/");
		const paramNames: string[] = [];
		for (const seg of segments) {
			if (seg.startsWith(":")) {
				paramNames.push(seg.slice(1));
			}
		}
		return { segments, paramNames };
	}

	function route(method: string, pattern: string, handler: RouteHandler): Api {
		const { segments, paramNames } = parsePattern(pattern);
		const count = segments.length;
		let list = routesBySegmentCount.get(count);
		if (list === undefined) {
			list = [];
			routesBySegmentCount.set(count, list);
		}
		list.push({ segments, paramNames, method, handler });
		return api;
	}

	function normalizePath(path: string): string {
		if (path.length > 1 && path.endsWith("/")) {
			return path.slice(0, -1);
		}
		return path;
	}

	function match(method: string, rawPath: string): MatchResult {
		const path = normalizePath(rawPath);
		const requestSegments = path.split("/");
		const count = requestSegments.length;
		const candidates = routesBySegmentCount.get(count);
		if (candidates === undefined) {
			return { type: "not_found" };
		}

		const allowedMethods: string[] = [];
		for (const route of candidates) {
			const params = matchSegments(
				requestSegments,
				route.segments,
				route.paramNames,
			);
			if (params !== null) {
				if (route.method === "*" || route.method === method) {
					return { type: "match", handler: route.handler, params };
				}
				if (method === "HEAD" && route.method === "GET") {
					return { type: "match", handler: route.handler, params };
				}
				if (!allowedMethods.includes(route.method)) {
					allowedMethods.push(route.method);
				}
			}
		}

		if (allowedMethods.length > 0) {
			return { type: "method_not_allowed", allow: allowedMethods.join(", ") };
		}
		return { type: "not_found" };
	}

	function handle(req: IncomingMessage, res: ServerResponse): void {
		const methodRaw = req.method ?? "GET";
		const url = req.url ?? "/";
		const qIdx = url.indexOf("?");
		const path = qIdx === -1 ? url : url.slice(0, qIdx);
		const queryString = qIdx === -1 ? "" : url.slice(qIdx + 1);

		const result = match(methodRaw, path);
		switch (result.type) {
			case "match":
				result.handler(req, res, result.params, path, queryString);
				break;
			case "method_not_allowed":
				options.methodNotAllowed(res, methodRaw, path, result.allow);
				break;
			case "not_found":
				options.notFound(res, methodRaw, path);
				break;
		}
	}

	const api: Api = { route, handle, match };
	return api;
}

/**
 * Core segment matcher (~20 lines).
 * Returns extracted params if all segments match, null otherwise.
 */
function matchSegments(
	request: string[],
	pattern: string[],
	paramNames: string[],
): Record<string, string> | null {
	const params: Record<string, string> = {};
	let paramIndex = 0;
	for (let i = 0; i < pattern.length; i++) {
		const patternSeg = pattern[i];
		const requestSeg = request[i];
		if (patternSeg === undefined || requestSeg === undefined) {
			return null;
		}
		if (patternSeg.startsWith(":")) {
			if (requestSeg.length === 0) {
				return null;
			}
			const name = paramNames[paramIndex];
			if (name === undefined) {
				return null;
			}
			params[name] = requestSeg;
			paramIndex++;
		} else if (patternSeg !== requestSeg) {
			return null;
		}
	}
	return params;
}
