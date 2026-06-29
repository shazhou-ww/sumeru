import type { IncomingMessage, ServerResponse } from "node:http";
import type { Prototype } from "@sumeru/core";
import {
	reloadPrototypeInConfig,
	removePrototypeFromConfig,
} from "../config.js";
import {
	assertSkillsExist,
	deletePrototypeFile,
	deleteSkill,
	prototypeFileExists,
	validatePrototype,
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

		detail(
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

		async create(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (await prototypeFileExists(hostConfig.prototypesDir, name)) {
				writeJson(
					res,
					409,
					errorEnvelope("prototype_exists", `Prototype ${name} already exists`),
				);
				return;
			}
			await upsertPrototype(req, res, hostConfig, name, "create");
		},

		async update(
			req: IncomingMessage,
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
			await upsertPrototype(req, res, hostConfig, name, "update");
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
	mode: "create" | "update",
): Promise<void> {
	let prototype: Prototype;
	try {
		prototype = await readPrototypeBody(req, name);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		writeJson(res, 400, errorEnvelope("invalid_body", message));
		return;
	}
	const missing = await assertSkillsExist(
		hostConfig.skillsDir,
		prototype.skills,
	);
	if (missing.length > 0) {
		writeJson(
			res,
			400,
			errorEnvelope(
				"skills_not_found",
				`Missing skills: ${missing.join(", ")}`,
			),
		);
		return;
	}
	try {
		await writePrototypeFile(hostConfig.prototypesDir, prototype);
		const info = await reloadPrototypeInConfig(hostConfig, name);
		writeJson(res, mode === "create" ? 201 : 200, prototypeEnvelope(info));
	} catch (err) {
		writePrototypeError(res, err);
	}
}

async function readPrototypeBody(
	req: IncomingMessage,
	expectedName: string,
): Promise<Prototype> {
	const contentType = req.headers["content-type"] ?? "";
	if (contentType.includes("application/json")) {
		const body = await readJsonBody(req);
		return validatePrototype(body, "request body", expectedName);
	}
	const raw = await readTextBody(req);
	const { parse: parseYaml } = await import("yaml");
	const doc = parseYaml(raw);
	return validatePrototype(doc, "request body", expectedName);
}

function writePrototypeError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	if (message.includes("must match") || message.includes("must be")) {
		writeJson(res, 400, errorEnvelope("invalid_prototype", message));
		return;
	}
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
