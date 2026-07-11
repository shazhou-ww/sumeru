import type { IncomingMessage, ServerResponse } from "node:http";
import {
	errorEnvelope,
	modelEnvelope,
	modelListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createModelsHandler(hostConfig: LoadedHostConfig) {
	const store = hostConfig.sqliteStore;

	return {
		listAll(
			_req: IncomingMessage,
			res: ServerResponse,
			_params: Record<string, string>,
			_path: string,
			queryString: string,
		): void {
			const provider = new URLSearchParams(queryString).get("provider");
			const models =
				provider !== null && provider.length > 0
					? store.listModels(provider)
					: store.listModels();
			writeJson(res, 200, modelListEnvelope(models));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const model = store.getModel(name);
			if (model === null) {
				writeJson(
					res,
					404,
					errorEnvelope("model_not_found", `Model ${name} not found`),
				);
				return;
			}
			writeJson(res, 200, modelEnvelope(model));
		},

		async upsert(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			let body: ModelUpdateBody;
			try {
				body = await readModelBody(req);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			const existing = store.getModel(name);
			if (existing === null) {
				if (body.provider === undefined || body.model === undefined) {
					writeJson(
						res,
						400,
						errorEnvelope(
							"invalid_body",
							'Fields "provider" and "model" are required for new model',
						),
					);
					return;
				}
				if (store.getProvider(body.provider) === null) {
					writeJson(
						res,
						404,
						errorEnvelope(
							"provider_not_found",
							`Provider ${body.provider} not found`,
						),
					);
					return;
				}
			} else if (body.provider !== undefined) {
				if (store.getProvider(body.provider) === null) {
					writeJson(
						res,
						404,
						errorEnvelope(
							"provider_not_found",
							`Provider ${body.provider} not found`,
						),
					);
					return;
				}
			}
			try {
				const model = store.upsertModel(name, {
					provider: body.provider,
					model: body.model,
					contextWindow: body.contextWindow,
					toolUse: body.toolUse,
					streaming: body.streaming,
					metadata: body.metadata,
				});
				writeJson(res, existing === null ? 201 : 200, modelEnvelope(model));
			} catch (err) {
				writeModelError(res, err);
			}
		},

		remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			if (!store.removeModel(name)) {
				writeJson(
					res,
					404,
					errorEnvelope("model_not_found", `Model ${name} not found`),
				);
				return;
			}
			res.statusCode = 204;
			res.end();
		},
	};
}

type ModelUpdateBody = {
	provider: string | undefined;
	model: string | undefined;
	contextWindow: number | null | undefined;
	toolUse: boolean | undefined;
	streaming: boolean | undefined;
	metadata: Record<string, unknown> | null | undefined;
};

async function readModelBody(req: IncomingMessage): Promise<ModelUpdateBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const providerRaw = obj.provider;
	let provider: string | undefined;
	if (providerRaw === undefined) {
		provider = undefined;
	} else if (typeof providerRaw !== "string" || providerRaw.length === 0) {
		throw new Error('Field "provider" must be a non-empty string');
	} else {
		provider = providerRaw;
	}
	const modelRaw = obj.model;
	let model: string | undefined;
	if (modelRaw === undefined) {
		model = undefined;
	} else if (typeof modelRaw !== "string" || modelRaw.length === 0) {
		throw new Error('Field "model" must be a non-empty string');
	} else {
		model = modelRaw;
	}
	const contextWindow =
		obj.contextWindow === undefined
			? undefined
			: parseOptionalNumber(obj.contextWindow, "contextWindow");
	const toolUse =
		obj.toolUse === undefined
			? undefined
			: parseBooleanField(obj.toolUse, "toolUse");
	const streaming =
		obj.streaming === undefined
			? undefined
			: parseBooleanField(obj.streaming, "streaming");
	const metadata =
		obj.metadata === undefined ? undefined : parseMetadataField(obj.metadata);
	return { provider, model, contextWindow, toolUse, streaming, metadata };
}

function parseOptionalNumber(value: unknown, field: string): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Field "${field}" must be a finite number or null`);
	}
	return value;
}

function parseBooleanField(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`Field "${field}" must be a boolean`);
	}
	return value;
}

function parseMetadataField(value: unknown): Record<string, unknown> | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error('Field "metadata" must be an object or null');
	}
	return value as Record<string, unknown>;
}

function writeModelError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
