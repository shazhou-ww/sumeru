import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope, imageEnvelope, imageListEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createImagesHandler(hostConfig: LoadedHostConfig) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const images = [...hostConfig.images.values()];
			writeJson(res, 200, imageListEnvelope(images));
		},

		detail(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const image = hostConfig.images.get(name);
			if (image === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope("image_not_found", `Image ${name} not found`),
				);
				return;
			}
			writeJson(res, 200, imageEnvelope(image));
		},
	};
}
