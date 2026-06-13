import type { IncomingMessage, ServerResponse } from "node:http";
import {
	errorEnvelope,
	gatewayEnvelope,
	gatewayListEnvelope,
	instanceEnvelope,
} from "./envelope.js";
import type { Gateway, GatewayConfig, ServerConfig } from "./types.js";

/**
 * Build the request handler for a server with the given config.
 *
 * Phase 1 routes:
 *   GET /                  → 200 @sumeru/instance envelope
 *   POST /                 → 405 with Allow: GET
 *   GET /gateways          → 200 @sumeru/gateway-list envelope
 *   POST /gateways         → 405 with Allow: GET
 *   GET /gateways/:name    → 200 @sumeru/gateway envelope OR 404 gateway_not_found
 *   POST /gateways/:name   → 405 with Allow: GET
 *   GET /<unknown>         → 404 not_found error envelope
 */
export function createHandler(
	config: ServerConfig,
): (req: IncomingMessage, res: ServerResponse) => void {
	return (req, res) => {
		const method = req.method ?? "GET";
		const url = req.url ?? "/";
		const path = stripQueryString(url);

		// GET /  (root)
		if (path === "/") {
			if (method === "GET") {
				writeJson(
					res,
					200,
					instanceEnvelope({
						name: config.name,
						version: config.version,
						gateways: Object.keys(config.gateways),
					}),
				);
				return;
			}
			methodNotAllowed(res, method, path);
			return;
		}

		// /gateways or /gateways/
		if (path === "/gateways" || path === "/gateways/") {
			if (method === "GET") {
				writeJson(
					res,
					200,
					gatewayListEnvelope(buildGatewayList(config.gateways)),
				);
				return;
			}
			methodNotAllowed(res, method, path);
			return;
		}

		// /gateways/<name> or /gateways/<name>/
		const detailMatch = matchGatewayDetail(path);
		if (detailMatch !== null) {
			if (method !== "GET") {
				methodNotAllowed(res, method, path);
				return;
			}
			const requested = decodePathSegment(detailMatch);
			if (requested === null) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"gateway_not_found",
						`Gateway ${detailMatch} not found`,
					),
				);
				return;
			}
			const cfg = config.gateways[requested];
			if (cfg === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope("gateway_not_found", `Gateway ${requested} not found`),
				);
				return;
			}
			writeJson(res, 200, gatewayEnvelope(buildGateway(requested, cfg)));
			return;
		}

		// Unknown path
		writeJson(
			res,
			404,
			errorEnvelope("not_found", `No route for ${method} ${path}`),
		);
	};
}

function stripQueryString(url: string): string {
	const q = url.indexOf("?");
	return q === -1 ? url : url.slice(0, q);
}

/**
 * Return the literal name segment from `/gateways/<segment>` or
 * `/gateways/<segment>/`, or `null` if `path` is not a gateway-detail path.
 *
 * The segment is returned in raw (still URL-encoded) form so the caller can
 * decide how to decode it.
 */
function matchGatewayDetail(path: string): string | null {
	const prefix = "/gateways/";
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	if (rest.length === 0) return null;
	// Strip a single trailing slash. Any remaining slash means it's a
	// nested path, which Phase 1 does not expose.
	const trimmed = rest.endsWith("/") ? rest.slice(0, -1) : rest;
	if (trimmed.length === 0) return null;
	if (trimmed.includes("/")) return null;
	return trimmed;
}

function decodePathSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

function methodNotAllowed(
	res: ServerResponse,
	method: string,
	path: string,
): void {
	res.setHeader("Allow", "GET");
	writeJson(
		res,
		405,
		errorEnvelope(
			"method_not_allowed",
			`Method ${method} not allowed on ${path}`,
		),
	);
}

function buildGatewayList(gateways: Record<string, GatewayConfig>): Gateway[] {
	const entries: Gateway[] = [];
	for (const [name, cfg] of Object.entries(gateways)) {
		entries.push(buildGateway(name, cfg));
	}
	return entries;
}

function buildGateway(name: string, cfg: GatewayConfig): Gateway {
	return {
		name,
		adapter: cfg.adapter,
		status: "ready",
		activeSessions: 0,
		capabilities: {
			resume: cfg.capabilities.resume,
			streaming: cfg.capabilities.streaming,
		},
	};
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}
