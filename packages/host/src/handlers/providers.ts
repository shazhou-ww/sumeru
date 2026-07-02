import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderApiType } from "@sumeru/core";
import {
	errorEnvelope,
	providerEnvelope,
	providerListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import { ProviderInUseError } from "../sqlite-store.js";
import type { LoadedHostConfig } from "../types.js";

export function createProvidersHandler(hostConfig: LoadedHostConfig) {
	const store = hostConfig.sqliteStore;

	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const providers = store.listProviders();
			writeJson(res, 200, providerListEnvelope(providers));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const provider = store.getProvider(name);
			if (provider === null) {
				writeJson(
					res,
					404,
					errorEnvelope("provider_not_found", `Provider ${name} not found`),
				);
				return;
			}
			writeJson(res, 200, providerEnvelope(provider));
		},

		async upsert(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			let body: ProviderUpdateBody;
			try {
				body = await readProviderBody(req, "update");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			const existing = store.getProvider(name);
			if (existing === null) {
				if (body.apiType === undefined) {
					writeJson(
						res,
						400,
						errorEnvelope(
							"invalid_body",
							'Field "apiType" is required for new provider',
						),
					);
					return;
				}
				try {
					const provider = store.createProvider({
						name,
						apiType: body.apiType,
						baseUrl: body.baseUrl ?? null,
						apiKey: body.apiKey ?? null,
					});
					writeJson(res, 201, providerEnvelope(provider));
				} catch (err) {
					writeProviderError(res, err);
				}
			} else {
				try {
					const provider = store.updateProvider(name, body);
					if (provider === null) {
						writeJson(
							res,
							404,
							errorEnvelope("provider_not_found", `Provider ${name} not found`),
						);
						return;
					}
					writeJson(res, 200, providerEnvelope(provider));
				} catch (err) {
					writeProviderError(res, err);
				}
			}
		},

		remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			if (store.getProvider(name) === null) {
				writeJson(
					res,
					404,
					errorEnvelope("provider_not_found", `Provider ${name} not found`),
				);
				return;
			}
			try {
				store.deleteProvider(name);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				if (err instanceof ProviderInUseError) {
					writeJson(res, 409, errorEnvelope("provider_in_use", err.message));
					return;
				}
				writeProviderError(res, err);
			}
		},
	};
}

type ProviderBody = {
	apiType: ProviderApiType;
	baseUrl: string | null;
	apiKey: string | null | undefined;
};

type ProviderUpdateBody = {
	apiType: ProviderApiType | undefined;
	baseUrl: string | null | undefined;
	apiKey: string | null | undefined;
};

async function readProviderBody(
	req: IncomingMessage,
	mode: "add",
): Promise<ProviderBody>;
async function readProviderBody(
	req: IncomingMessage,
	mode: "update",
): Promise<ProviderUpdateBody>;
async function readProviderBody(
	req: IncomingMessage,
	mode: "add" | "update",
): Promise<ProviderBody | ProviderUpdateBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const apiTypeRaw = obj.apiType;
	let apiType: ProviderApiType | undefined;
	if (apiTypeRaw === undefined) {
		if (mode === "add") {
			throw new Error('Field "apiType" is required');
		}
	} else if (apiTypeRaw !== "anthropic" && apiTypeRaw !== "openai") {
		throw new Error('Field "apiType" must be "anthropic" or "openai"');
	} else {
		apiType = apiTypeRaw;
	}
	const baseUrlRaw = obj.baseUrl;
	let baseUrl: string | null | undefined;
	if (baseUrlRaw === undefined) {
		baseUrl = mode === "add" ? null : undefined;
	} else if (baseUrlRaw === null) {
		baseUrl = null;
	} else if (typeof baseUrlRaw !== "string" || baseUrlRaw.length === 0) {
		throw new Error('Field "baseUrl" must be a non-empty string or null');
	} else {
		baseUrl = baseUrlRaw;
	}
	const apiKeyRaw = obj.apiKey;
	let apiKey: string | null | undefined;
	if (apiKeyRaw !== undefined) {
		if (apiKeyRaw === null) {
			apiKey = null;
		} else if (typeof apiKeyRaw === "string") {
			apiKey = apiKeyRaw.length > 0 ? apiKeyRaw : null;
		} else {
			throw new Error('Field "apiKey" must be a string or null');
		}
	}
	if (mode === "add") {
		return {
			apiType: apiType as ProviderApiType,
			baseUrl: baseUrl ?? null,
			apiKey,
		};
	}
	return { apiType, baseUrl, apiKey };
}

function writeProviderError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
