import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope, hostEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";

export function createRootHandler(input: {
	manager: SessionManager;
	version: string;
}) {
	return (_req: IncomingMessage, res: ServerResponse): void => {
		const root = input.manager.hostRoot();
		writeJson(
			res,
			200,
			hostEnvelope({
				name: root.name,
				version: input.version,
				prototypes: root.prototypes,
				sessions: root.sessions,
			}),
		);
	};
}

export function writeRouteNotFound(
	res: ServerResponse,
	method: string,
	path: string,
): void {
	writeJson(
		res,
		404,
		errorEnvelope("route_not_found", `No route for ${method} ${path}`),
	);
}

export function writeMethodNotAllowed(
	res: ServerResponse,
	method: string,
	path: string,
	allow: string,
): void {
	res.setHeader("Allow", allow);
	writeJson(
		res,
		405,
		errorEnvelope(
			"method_not_allowed",
			`${method} not allowed for ${path}; allowed: ${allow}`,
		),
	);
}
