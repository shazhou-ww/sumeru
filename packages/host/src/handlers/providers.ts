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

		async add(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (store.getProvider(name) !== null) {
				writeJson(
					res,
					409,
					errorEnvelope("provider_exists", `Provider ${name} already exists`),
				);
				return;
			}
			let body: ProviderBody;
			try {
				body = await readProviderBody(req);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			try {
				const provider = store.createProvider({
					name,
					apiType: body.apiType,
					baseUrl: body.baseUrl,
					apiKey: body.apiKey ?? null,
				});
				writeJson(res, 201, providerEnvelope(provider));
			} catch (err) {
				writeProviderError(res, err);
			}
		},

		async update(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (store.getProvider(name) === null) {
				writeJson(
					res,
					404,
					errorEnvelope("provider_not_found", `Provider ${name} not found`),
				);
				return;
			}
			let body: ProviderBody;
			try {
				body = await readProviderBody(req);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			try {
				const provider = store.updateProvider(name, {
					apiType: body.apiType,
					baseUrl: body.baseUrl,
					apiKey: body.apiKey,
				});
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

async function readProviderBody(req: IncomingMessage): Promise<ProviderBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const apiType = obj.apiType;
	if (apiType !== "anthropic" && apiType !== "openai") {
		throw new Error('Field "apiType" must be "anthropic" or "openai"');
	}
	const baseUrlRaw = obj.baseUrl;
	let baseUrl: string | null = null;
	if (baseUrlRaw !== undefined && baseUrlRaw !== null) {
		if (typeof baseUrlRaw !== "string" || baseUrlRaw.length === 0) {
			throw new Error('Field "baseUrl" must be a non-empty string or null');
		}
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
	return { apiType, baseUrl, apiKey };
}

function writeProviderError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
