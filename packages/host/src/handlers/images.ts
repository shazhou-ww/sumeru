import type { IncomingMessage, ServerResponse } from "node:http";
import type { Image } from "@sumeru/core";
import { removeImageFromConfig, saveImageInConfig } from "../config.js";
import {
	errorEnvelope,
	imageEnvelope,
	imageListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createImagesHandler(hostConfig: LoadedHostConfig) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const images = [...hostConfig.images.values()];
			writeJson(res, 200, imageListEnvelope(images));
		},

		get(
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

		async add(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			let body: ImageBody;
			try {
				body = await readImageBody(req);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			if (body.name.length > 0 && body.name !== name) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_body",
						`Body name ${body.name} does not match URL name ${name}`,
					),
				);
				return;
			}
			const existed = hostConfig.images.has(name);
			const image: Image = {
				name,
				description: body.description,
				dockerfile: body.dockerfile,
				builtAt: body.builtAt,
				digest: body.digest,
			};
			try {
				await saveImageInConfig(hostConfig, image);
				writeJson(res, existed ? 200 : 201, imageEnvelope(image));
			} catch (err) {
				writeImageError(res, err);
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (!hostConfig.images.has(name)) {
				writeJson(
					res,
					404,
					errorEnvelope("image_not_found", `Image ${name} not found`),
				);
				return;
			}
			try {
				await removeImageFromConfig(hostConfig, name);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writeImageError(res, err);
			}
		},
	};
}

type ImageBody = {
	name: string;
	description: string;
	dockerfile: string;
	builtAt: string;
	digest: string;
};

async function readImageBody(req: IncomingMessage): Promise<ImageBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const nameRaw = obj.name;
	const name = typeof nameRaw === "string" ? nameRaw : "";
	const description = obj.description;
	if (typeof description !== "string") {
		throw new Error('Field "description" must be a string');
	}
	const dockerfile = obj.dockerfile;
	if (typeof dockerfile !== "string" || dockerfile.length === 0) {
		throw new Error('Field "dockerfile" must be a non-empty string');
	}
	const builtAt = obj.builtAt;
	if (typeof builtAt !== "string" || builtAt.length === 0) {
		throw new Error('Field "builtAt" must be a non-empty string');
	}
	const digest = obj.digest;
	if (typeof digest !== "string" || digest.length === 0) {
		throw new Error('Field "digest" must be a non-empty string');
	}
	return { name, description, dockerfile, builtAt, digest };
}

function writeImageError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
