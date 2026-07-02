import type { IncomingMessage, ServerResponse } from "node:http";
import { getAdapterManifest, listAdapters } from "../adapter-registry.js";
import {
	adapterEnvelope,
	adapterListEnvelope,
	errorEnvelope,
} from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createAdaptersHandler(_hostConfig: LoadedHostConfig) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, adapterListEnvelope(listAdapters()));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const manifest = getAdapterManifest(name);
			if (manifest === null) {
				writeJson(
					res,
					404,
					errorEnvelope("adapter_not_found", `Adapter ${name} not found`),
				);
				return;
			}
			writeJson(res, 200, adapterEnvelope(manifest));
		},
	};
}
