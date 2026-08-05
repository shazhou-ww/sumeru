import type { IncomingMessage, ServerResponse } from "node:http";
import {
	getAdapterListModels,
	getAdapterManifest,
	listAdapters as listRegistryAdapters,
} from "../adapter-registry.js";
import { AdapterInUseError, AdapterResolveError } from "../adapter-store.js";
import {
	adapterEnvelope,
	adapterListEnvelope,
	adapterModelListEnvelope,
	errorEnvelope,
	installedAdapterEnvelope,
	installedAdapterListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";
import { toAdapterInfo } from "../types.js";

export function createAdaptersHandler(hostConfig: LoadedHostConfig) {
	const store = hostConfig.adapterStore;

	return {
		async list(_req: IncomingMessage, res: ServerResponse): Promise<void> {
			const installed = await store.listAdapters();
			if (installed.length > 0) {
				writeJson(res, 200, installedAdapterListEnvelope(installed));
				return;
			}
			// Fall back to built-in registry while no adapters have been installed yet.
			writeJson(res, 200, adapterListEnvelope(listRegistryAdapters()));
		},

		async get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			await respondGet(store, name, res);
		},

		async install(req: IncomingMessage, res: ServerResponse): Promise<void> {
			let source: string;
			try {
				const body = await readJsonBody(req);
				if (body === null || typeof body !== "object" || Array.isArray(body)) {
					throw new Error("Request body must be a JSON object");
				}
				const raw = (body as Record<string, unknown>).source;
				if (typeof raw !== "string" || raw.length === 0) {
					throw new Error('Field "source" is required');
				}
				source = raw;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			try {
				const { adapter, isNew } = await store.installAdapter(source);
				const status = isNew ? 201 : 200;
				writeJson(res, status, installedAdapterEnvelope(adapter));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("adapter_install_failed", message));
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const ref = params.name ?? "";
			try {
				await store.uninstallAdapter(ref);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				if (err instanceof AdapterInUseError) {
					writeJson(res, 409, errorEnvelope("adapter_in_use", err.message));
					return;
				}
				if (err instanceof AdapterResolveError) {
					writeJson(res, 404, errorEnvelope("adapter_not_found", err.message));
					return;
				}
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes("not found")) {
					writeJson(res, 404, errorEnvelope("adapter_not_found", message));
					return;
				}
				writeJson(res, 500, errorEnvelope("internal_error", message));
			}
		},

		async models(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
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
			const listModels = getAdapterListModels(name);
			if (listModels === null) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"models_not_supported",
						`Adapter ${name} does not support model listing`,
					),
				);
				return;
			}
			const envVar = manifest.credentialEnv;
			if (envVar === null) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"credential_missing",
						`Adapter ${name} has no credentialEnv`,
					),
				);
				return;
			}
			const credential = process.env[envVar];
			if (credential === undefined || credential.length === 0) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"credential_missing",
						`Environment variable ${envVar} is not set`,
					),
				);
				return;
			}
			try {
				const models = await listModels(credential);
				writeJson(res, 200, adapterModelListEnvelope(models));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 502, errorEnvelope("model_list_failed", message));
			}
		},
	};
}

async function respondGet(
	store: LoadedHostConfig["adapterStore"],
	name: string,
	res: ServerResponse,
): Promise<void> {
	try {
		const installed = await store.resolveAdapter(name);
		writeJson(res, 200, installedAdapterEnvelope(installed));
		return;
	} catch (err) {
		if (!(err instanceof AdapterResolveError)) {
			const message = err instanceof Error ? err.message : String(err);
			writeJson(res, 500, errorEnvelope("internal_error", message));
			return;
		}
	}

	const manifest = getAdapterManifest(name);
	if (manifest === null) {
		writeJson(
			res,
			404,
			errorEnvelope("adapter_not_found", `Adapter ${name} not found`),
		);
		return;
	}
	writeJson(res, 200, adapterEnvelope(toAdapterInfo(manifest)));
}
