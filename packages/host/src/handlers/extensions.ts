import type { IncomingMessage, ServerResponse } from "node:http";
import type { Extension } from "@sumeru/core";
import { reloadExtensionInConfig } from "../config.js";
import { deleteExtensionFile, writeExtensionFile } from "../data-store.js";
import {
	errorEnvelope,
	extensionEnvelope,
	extensionListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createExtensionsHandler(hostConfig: LoadedHostConfig) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const extensions = [...hostConfig.extensions.values()];
			writeJson(res, 200, extensionListEnvelope(extensions));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const extension = hostConfig.extensions.get(name);
			if (extension === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope("extension_not_found", `Extension ${name} not found`),
				);
				return;
			}
			writeJson(res, 200, extensionEnvelope(extension));
		},

		async upsert(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			let body: ExtensionUpdateBody;
			try {
				body = await readExtensionBody(req);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			const exists = hostConfig.extensions.has(name);
			if (!exists) {
				if (body.dockerfile === undefined || body.dockerfile.length === 0) {
					writeJson(
						res,
						400,
						errorEnvelope(
							"invalid_body",
							'Field "dockerfile" is required for new extension',
						),
					);
					return;
				}
			} else if (
				body.dockerfile !== undefined &&
				body.dockerfile.length === 0
			) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_body",
						'Field "dockerfile" must be a non-empty string',
					),
				);
				return;
			}
			const now = new Date().toISOString();
			let extension: Extension;
			if (!exists) {
				extension = {
					name,
					description: body.description ?? "",
					dockerfile: body.dockerfile as string,
					createdAt: now,
					updatedAt: now,
				};
			} else {
				const existing = hostConfig.extensions.get(name) as Extension;
				extension = {
					name,
					description:
						body.description !== undefined
							? body.description
							: existing.description,
					dockerfile:
						body.dockerfile !== undefined
							? body.dockerfile
							: existing.dockerfile,
					createdAt: existing.createdAt,
					updatedAt: now,
				};
			}
			try {
				await writeExtensionFile(hostConfig.extensionsDir, extension);
				const reloaded = await reloadExtensionInConfig(hostConfig, name);
				writeJson(res, exists ? 200 : 201, extensionEnvelope(reloaded));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 500, errorEnvelope("internal_error", message));
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (!hostConfig.extensions.has(name)) {
				writeJson(
					res,
					404,
					errorEnvelope("extension_not_found", `Extension ${name} not found`),
				);
				return;
			}
			try {
				await deleteExtensionFile(hostConfig.extensionsDir, name);
				hostConfig.extensions.delete(name);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 500, errorEnvelope("internal_error", message));
			}
		},
	};
}

type ExtensionUpdateBody = {
	description: string | undefined;
	dockerfile: string | undefined;
};

async function readExtensionBody(
	req: IncomingMessage,
): Promise<ExtensionUpdateBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const descriptionRaw = obj.description;
	let description: string | undefined;
	if (descriptionRaw !== undefined) {
		if (typeof descriptionRaw !== "string") {
			throw new Error('Field "description" must be a string');
		}
		description = descriptionRaw;
	}
	const dockerfileRaw = obj.dockerfile;
	let dockerfile: string | undefined;
	if (dockerfileRaw !== undefined) {
		if (typeof dockerfileRaw !== "string") {
			throw new Error('Field "dockerfile" must be a string');
		}
		dockerfile = dockerfileRaw;
	}
	return { description, dockerfile };
}
