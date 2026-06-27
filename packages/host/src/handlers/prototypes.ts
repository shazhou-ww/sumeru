import type { IncomingMessage, ServerResponse } from "node:http";
import {
	errorEnvelope,
	prototypeEnvelope,
	prototypeListEnvelope,
} from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createPrototypesHandler(hostConfig: LoadedHostConfig) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const prototypes = [...hostConfig.prototypes.values()];
			writeJson(res, 200, prototypeListEnvelope(prototypes));
		},
		detail(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const prototype = hostConfig.prototypes.get(params.name ?? "");
			if (prototype === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"prototype_not_found",
						`Prototype ${params.name ?? ""} not found`,
					),
				);
				return;
			}
			writeJson(res, 200, prototypeEnvelope(prototype));
		},
	};
}
