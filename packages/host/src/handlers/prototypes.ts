import type { IncomingMessage, ServerResponse } from "node:http";
import type { Prototype } from "@sumeru/core";
import { getAdapterManifest } from "../adapter-registry.js";
import {
	reloadPrototypeInConfig,
	removePrototypeFromConfig,
} from "../config.js";
import {
	deletePrototypeFile,
	mergePrototype,
	type PrototypeUpdateBody,
	prototypeFileExists,
	readPrototypeFile,
	validatePrototype,
	validatePrototypeUpdate,
	writePrototypeFile,
} from "../data-store.js";
import {
	errorEnvelope,
	prototypeEnvelope,
	prototypeListEnvelope,
} from "../envelope.js";
import { readJsonBody, readTextBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createPrototypesHandler(hostConfig: LoadedHostConfig) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const prototypes = [...hostConfig.prototypes.values()];
			writeJson(res, 200, prototypeListEnvelope(prototypes));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const prototype = hostConfig.prototypes.get(params.name ?? "");
			if (prototype === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"prototype_not_found",
						`Prototype ${params.name ?? ""} not found`,
					),
				);
				return;
			}
			writeJson(res, 200, prototypeEnvelope(prototype));
		},

		async upsert(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			await upsertPrototype(req, res, hostConfig, name);
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (!(await prototypeFileExists(hostConfig.prototypesDir, name))) {
				writeJson(
					res,
					404,
					errorEnvelope("prototype_not_found", `Prototype ${name} not found`),
				);
				return;
			}
			try {
				await deletePrototypeFile(hostConfig.prototypesDir, name);
				await removePrototypeFromConfig(hostConfig, name);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writePrototypeError(res, err);
			}
		},
	};
}

async function upsertPrototype(
	req: IncomingMessage,
	res: ServerResponse,
	hostConfig: LoadedHostConfig,
	name: string,
): Promise<void> {
	const existing = hostConfig.prototypes.get(name);
	const mode = existing === undefined ? "add" : "update";
	let prototype: Prototype;
	try {
		if (mode === "add") {
			prototype = await readPrototypeBody(req, name, "add");
		} else {
			const existing = await readPrototypeFile(hostConfig.prototypesDir, name);
			const update = await readPrototypeBody(req, name, "update");
			prototype = mergePrototype(existing, update);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		writeJson(res, 400, errorEnvelope("invalid_body", message));
		return;
	}
	const persona = hostConfig.sqliteStore.getPersona(prototype.persona);
	if (persona === null) {
		writeJson(
			res,
			400,
			errorEnvelope(
				"persona_not_found",
				`Persona ${prototype.persona} not found`,
			),
		);
		return;
	}
	const manifest = getAdapterManifest(prototype.adapter);
	if (manifest === null) {
		writeJson(
			res,
			400,
			errorEnvelope(
				"adapter_not_found",
				`Adapter ${prototype.adapter} not found`,
			),
		);
		return;
	}
	if (prototype.model !== null) {
		if (!prototype.model.startsWith(":")) {
			const model = hostConfig.sqliteStore.getModel(prototype.model);
			if (model === null && manifest.providerMode === "custom-only") {
				writeJson(
					res,
					400,
					errorEnvelope(
						"model_not_found",
						`Model ${prototype.model} not found`,
					),
				);
				return;
			}
		}
	} else if (manifest.providerMode !== "builtin-only") {
		writeJson(
			res,
			400,
			errorEnvelope(
				"model_required",
				`Prototype ${prototype.name} requires a model for adapter ${prototype.adapter}`,
			),
		);
		return;
	}
	if (prototype.extensions !== null) {
		for (const extName of prototype.extensions) {
			if (!hostConfig.extensions.has(extName)) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"extension_not_found",
						`Extension ${extName} not found`,
					),
				);
				return;
			}
		}
	}
	try {
		await writePrototypeFile(hostConfig.prototypesDir, prototype);
		const info = await reloadPrototypeInConfig(hostConfig, name);
		writeJson(res, mode === "add" ? 201 : 200, prototypeEnvelope(info));
	} catch (err) {
		if (mode === "add") {
			try {
				await deletePrototypeFile(hostConfig.prototypesDir, name);
			} catch {
				// best-effort rollback when compose validation fails after yaml write
			}
		}
		writePrototypeError(res, err);
	}
}

async function readPrototypeBody(
	req: IncomingMessage,
	expectedName: string,
	mode: "add",
): Promise<Prototype>;
async function readPrototypeBody(
	req: IncomingMessage,
	expectedName: string,
	mode: "update",
): Promise<PrototypeUpdateBody>;
async function readPrototypeBody(
	req: IncomingMessage,
	expectedName: string,
	mode: "add" | "update",
): Promise<Prototype | PrototypeUpdateBody> {
	const contentType = req.headers["content-type"] ?? "";
	if (contentType.includes("application/json")) {
		const body = await readJsonBody(req);
		if (mode === "add") {
			return validatePrototype(body, "request body", expectedName);
		}
		return validatePrototypeUpdate(body, "request body", expectedName);
	}
	const raw = await readTextBody(req);
	const { parse: parseYaml } = await import("yaml");
	const doc = parseYaml(raw);
	if (mode === "add") {
		return validatePrototype(doc, "request body", expectedName);
	}
	return validatePrototypeUpdate(doc, "request body", expectedName);
}

function writePrototypeError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	if (message.includes("must match") || message.includes("must be")) {
		writeJson(res, 400, errorEnvelope("invalid_prototype", message));
		return;
	}
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
