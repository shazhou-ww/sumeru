import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope, instanceEnvelope } from "./envelope.js";
import type { ServerConfig } from "./types.js";

/**
 * Build the request handler for a server with the given config.
 *
 * Phase 0 routes:
 *   GET /            → 200 instance envelope
 *   POST /           → 405 with Allow: GET
 *   GET /<unknown>   → 404 error envelope
 *   * /<unknown>     → 404 error envelope
 */
export function createHandler(
	config: ServerConfig,
): (req: IncomingMessage, res: ServerResponse) => void {
	return (req, res) => {
		const method = req.method ?? "GET";
		const url = req.url ?? "/";
		const path = url.split("?", 1)[0] ?? "/";

		if (path === "/") {
			if (method === "GET") {
				writeJson(
					res,
					200,
					instanceEnvelope({
						name: config.name,
						version: config.version,
						gateways: [],
					}),
				);
				return;
			}
			res.setHeader("Allow", "GET");
			writeJson(
				res,
				405,
				errorEnvelope(
					"method_not_allowed",
					`Method ${method} not allowed on ${path}`,
				),
			);
			return;
		}

		writeJson(
			res,
			404,
			errorEnvelope("not_found", `No route for ${method} ${path}`),
		);
	};
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}
