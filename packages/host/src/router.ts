import type { IncomingMessage, ServerResponse } from "node:http";
import type { MatchResult, RouteHandler } from "./types.js";

type Route = {
	segments: Array<string>;
	paramNames: Array<string>;
	method: string;
	handler: RouteHandler;
};

export type Router = {
	route(method: string, pattern: string, handler: RouteHandler): Router;
	handle(req: IncomingMessage, res: ServerResponse): void;
	match(method: string, path: string): MatchResult;
};

export function createRouter(options: {
	methodNotAllowed: (
		res: ServerResponse,
		method: string,
		path: string,
		allow: string,
	) => void;
	notFound: (res: ServerResponse, method: string, path: string) => void;
}): Router {
	const routesBySegmentCount = new Map<number, Array<Route>>();

	function parsePattern(pattern: string): {
		segments: Array<string>;
		paramNames: Array<string>;
	} {
		const segments = pattern.split("/");
		const paramNames: Array<string> = [];
		for (const seg of segments) {
			if (seg.startsWith(":")) {
				paramNames.push(seg.slice(1));
			}
		}
		return { segments, paramNames };
	}

	function route(
		method: string,
		pattern: string,
		handler: RouteHandler,
	): Router {
		const { segments, paramNames } = parsePattern(pattern);
		const count = segments.length;
		let list = routesBySegmentCount.get(count);
		if (list === undefined) {
			list = [];
			routesBySegmentCount.set(count, list);
		}
		list.push({ segments, paramNames, method, handler });
		return router;
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

		const allowedMethods: Array<string> = [];
		for (const routeEntry of candidates) {
			const params = matchSegments(
				requestSegments,
				routeEntry.segments,
				routeEntry.paramNames,
			);
			if (params !== null) {
				if (routeEntry.method === method) {
					return { type: "match", handler: routeEntry.handler, params };
				}
				if (method === "HEAD" && routeEntry.method === "GET") {
					return { type: "match", handler: routeEntry.handler, params };
				}
				if (!allowedMethods.includes(routeEntry.method)) {
					allowedMethods.push(routeEntry.method);
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
				void result.handler(req, res, result.params, path, queryString);
				break;
			case "method_not_allowed":
				options.methodNotAllowed(res, methodRaw, path, result.allow);
				break;
			case "not_found":
				options.notFound(res, methodRaw, path);
				break;
		}
	}

	const router: Router = { route, handle, match };
	return router;
}

function matchSegments(
	request: Array<string>,
	pattern: Array<string>,
	paramNames: Array<string>,
): Record<string, string> | null {
	const params: Record<string, string> = {};
	let paramIndex = 0;
	for (let i = 0; i < pattern.length; i += 1) {
		const patternSeg = pattern[i];
		const requestSeg = request[i];
		if (patternSeg === undefined || requestSeg === undefined) {
			return null;
		}
		if (patternSeg.startsWith(":")) {
			if (requestSeg.length === 0) return null;
			const name = paramNames[paramIndex];
			if (name === undefined) return null;
			params[name] = requestSeg;
			paramIndex += 1;
		} else if (patternSeg !== requestSeg) {
			return null;
		}
	}
	return params;
}
