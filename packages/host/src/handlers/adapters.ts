import type { IncomingMessage, ServerResponse } from "node:http";
import { getAdapterManifest, listAdapters } from "../adapter-registry.js";
import {
	adapterEnvelope,
	adapterListEnvelope,
	adapterModelListEnvelope,
	errorEnvelope,
} from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";
import { toAdapterInfo } from "../types.js";

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
			writeJson(res, 200, adapterEnvelope(toAdapterInfo(manifest)));
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
			if (manifest.listModels === null) {
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
				const models = await manifest.listModels(credential);
				writeJson(res, 200, adapterModelListEnvelope(models));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 502, errorEnvelope("model_list_failed", message));
			}
		},
	};
}
