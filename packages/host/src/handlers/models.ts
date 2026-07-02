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
		listAll(_req: IncomingMessage, res: ServerResponse): void {
			const models = store.listModels();
			writeJson(res, 200, modelListEnvelope(models));
		},

		list(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const provider = params.name ?? "";
			const models = store.listModels(provider);
			writeJson(res, 200, modelListEnvelope(models));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const provider = params.name ?? "";
			const modelName = params.modelName ?? "";
			const model = store.getModel(provider, modelName);
			if (model === null) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"model_not_found",
						`Model ${provider}:${modelName} not found`,
					),
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
			const provider = params.name ?? "";
			const modelName = params.modelName ?? "";
			if (store.getProvider(provider) === null) {
				writeJson(
					res,
					404,
					errorEnvelope("provider_not_found", `Provider ${provider} not found`),
				);
				return;
			}
			let body: ModelUpdateBody;
			try {
				body = await readModelBody(req);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			const existing = store.getModel(provider, modelName);
			if (existing === null) {
				if (body.model === undefined) {
					writeJson(
						res,
						400,
						errorEnvelope(
							"invalid_body",
							'Field "model" is required for new model',
						),
					);
					return;
				}
				try {
					const model = store.createModel({
						provider,
						name: modelName,
						model: body.model,
						contextWindow: body.contextWindow ?? null,
						toolUse: body.toolUse ?? true,
						streaming: body.streaming ?? true,
						metadata: body.metadata ?? null,
					});
					writeJson(res, 201, modelEnvelope(model));
				} catch (err) {
					writeModelError(res, err);
				}
			} else {
				try {
					const model = store.updateModel(provider, modelName, body);
					if (model === null) {
						writeJson(
							res,
							404,
							errorEnvelope(
								"model_not_found",
								`Model ${provider}:${modelName} not found`,
							),
						);
						return;
					}
					writeJson(res, 200, modelEnvelope(model));
				} catch (err) {
					writeModelError(res, err);
				}
			}
		},

		remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const provider = params.name ?? "";
			const modelName = params.modelName ?? "";
			if (store.getModel(provider, modelName) === null) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"model_not_found",
						`Model ${provider}:${modelName} not found`,
					),
				);
				return;
			}
			try {
				store.deleteModel(provider, modelName);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writeModelError(res, err);
			}
		},
	};
}

type ModelUpdateBody = {
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
	return { model, contextWindow, toolUse, streaming, metadata };
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
