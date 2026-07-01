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
		list(_req: IncomingMessage, res: ServerResponse): void {
			const models = store.listModels();
			writeJson(res, 200, modelListEnvelope(models));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const id = params.id ?? "";
			const model = store.getModel(id);
			if (model === null) {
				writeJson(
					res,
					404,
					errorEnvelope("model_not_found", `Model ${id} not found`),
				);
				return;
			}
			writeJson(res, 200, modelEnvelope(model));
		},

		async add(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const id = params.id ?? "";
			if (store.getModel(id) !== null) {
				writeJson(
					res,
					409,
					errorEnvelope("model_exists", `Model ${id} already exists`),
				);
				return;
			}
			let body: ModelBody;
			try {
				body = await readModelBody(req, "add");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			if (store.getProvider(body.provider) === null) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"provider_not_found",
						`Provider ${body.provider} not found`,
					),
				);
				return;
			}
			try {
				const model = store.createModel({ id, ...body });
				writeJson(res, 201, modelEnvelope(model));
			} catch (err) {
				writeModelError(res, err);
			}
		},

		async update(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const id = params.id ?? "";
			if (store.getModel(id) === null) {
				writeJson(
					res,
					404,
					errorEnvelope("model_not_found", `Model ${id} not found`),
				);
				return;
			}
			let body: ModelUpdateBody;
			try {
				body = await readModelBody(req, "update");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			if (
				body.provider !== undefined &&
				store.getProvider(body.provider) === null
			) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"provider_not_found",
						`Provider ${body.provider} not found`,
					),
				);
				return;
			}
			try {
				const model = store.updateModel(id, body);
				if (model === null) {
					writeJson(
						res,
						404,
						errorEnvelope("model_not_found", `Model ${id} not found`),
					);
					return;
				}
				writeJson(res, 200, modelEnvelope(model));
			} catch (err) {
				writeModelError(res, err);
			}
		},

		remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const id = params.id ?? "";
			if (!store.deleteModel(id)) {
				writeJson(
					res,
					404,
					errorEnvelope("model_not_found", `Model ${id} not found`),
				);
				return;
			}
			res.statusCode = 204;
			res.end();
		},
	};
}

type ModelBody = {
	provider: string;
	model: string;
	contextWindow: number | null;
	toolUse: boolean;
	streaming: boolean;
	metadata: Record<string, unknown> | null;
};

type ModelUpdateBody = {
	provider: string | undefined;
	model: string | undefined;
	contextWindow: number | null | undefined;
	toolUse: boolean | undefined;
	streaming: boolean | undefined;
	metadata: Record<string, unknown> | null | undefined;
};

async function readModelBody(
	req: IncomingMessage,
	mode: "add",
): Promise<ModelBody>;
async function readModelBody(
	req: IncomingMessage,
	mode: "update",
): Promise<ModelUpdateBody>;
async function readModelBody(
	req: IncomingMessage,
	mode: "add" | "update",
): Promise<ModelBody | ModelUpdateBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const providerRaw = obj.provider;
	let provider: string | undefined;
	if (providerRaw === undefined) {
		if (mode === "add") {
			throw new Error('Field "provider" is required');
		}
	} else if (typeof providerRaw !== "string" || providerRaw.length === 0) {
		throw new Error('Field "provider" must be a non-empty string');
	} else {
		provider = providerRaw;
	}
	const modelRaw = obj.model;
	let model: string | undefined;
	if (modelRaw === undefined) {
		if (mode === "add") {
			throw new Error('Field "model" is required');
		}
	} else if (typeof modelRaw !== "string" || modelRaw.length === 0) {
		throw new Error('Field "model" must be a non-empty string');
	} else {
		model = modelRaw;
	}
	const contextWindow =
		obj.contextWindow === undefined && mode === "update"
			? undefined
			: parseOptionalNumber(obj.contextWindow, "contextWindow");
	const toolUse =
		obj.toolUse === undefined && mode === "update"
			? undefined
			: parseBooleanField(obj.toolUse, "toolUse", true);
	const streaming =
		obj.streaming === undefined && mode === "update"
			? undefined
			: parseBooleanField(obj.streaming, "streaming", true);
	const metadata =
		obj.metadata === undefined && mode === "update"
			? undefined
			: parseMetadataField(obj.metadata);
	if (mode === "add") {
		return {
			provider: provider as string,
			model: model as string,
			contextWindow,
			toolUse: toolUse as boolean,
			streaming: streaming as boolean,
			metadata,
		};
	}
	return { provider, model, contextWindow, toolUse, streaming, metadata };
}

function parseOptionalNumber(value: unknown, field: string): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Field "${field}" must be a finite number or null`);
	}
	return value;
}

function parseBooleanField(
	value: unknown,
	field: string,
	defaultValue: boolean,
): boolean {
	if (value === undefined) return defaultValue;
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
