import type { IncomingMessage, ServerResponse } from "node:http";
import { findPrototypeReferencesToPersona } from "../data-store.js";
import {
	errorEnvelope,
	personaEnvelope,
	personaListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createPersonasHandler(hostConfig: LoadedHostConfig) {
	const store = hostConfig.sqliteStore;

	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			const personas = store.listPersonas();
			writeJson(res, 200, personaListEnvelope(personas));
		},

		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const persona = store.getPersona(name);
			if (persona === null) {
				writeJson(
					res,
					404,
					errorEnvelope("persona_not_found", `Persona ${name} not found`),
				);
				return;
			}
			writeJson(res, 200, personaEnvelope(persona));
		},

		async add(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (store.getPersona(name) !== null) {
				writeJson(
					res,
					409,
					errorEnvelope("persona_exists", `Persona ${name} already exists`),
				);
				return;
			}
			let body: PersonaBody;
			try {
				body = await readPersonaBody(req, "add");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			const missing = findMissingSkills(store, body.skills);
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
				const persona = store.createPersona({
					name,
					instructions: body.instructions,
					skills: body.skills,
				});
				writeJson(res, 201, personaEnvelope(persona));
			} catch (err) {
				writePersonaError(res, err);
			}
		},

		async update(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (store.getPersona(name) === null) {
				writeJson(
					res,
					404,
					errorEnvelope("persona_not_found", `Persona ${name} not found`),
				);
				return;
			}
			let body: PersonaUpdateBody;
			try {
				body = await readPersonaBody(req, "update");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeJson(res, 400, errorEnvelope("invalid_body", message));
				return;
			}
			if (body.skills !== undefined) {
				const missing = findMissingSkills(store, body.skills);
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
			}
			try {
				const persona = store.updatePersona(name, body);
				if (persona === null) {
					writeJson(
						res,
						404,
						errorEnvelope("persona_not_found", `Persona ${name} not found`),
					);
					return;
				}
				writeJson(res, 200, personaEnvelope(persona));
			} catch (err) {
				writePersonaError(res, err);
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (store.getPersona(name) === null) {
				writeJson(
					res,
					404,
					errorEnvelope("persona_not_found", `Persona ${name} not found`),
				);
				return;
			}
			const references = await findPrototypeReferencesToPersona(
				hostConfig.prototypesDir,
				name,
			);
			if (references.length > 0) {
				writeJson(
					res,
					409,
					errorEnvelope(
						"persona_in_use",
						`Persona ${name} is referenced by prototypes: ${references.join(", ")}`,
					),
				);
				return;
			}
			try {
				store.deletePersona(name);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writePersonaError(res, err);
			}
		},
	};
}

type PersonaBody = {
	instructions: string;
	skills: Array<string>;
};

type PersonaUpdateBody = {
	instructions: string | undefined;
	skills: Array<string> | undefined;
};

async function readPersonaBody(
	req: IncomingMessage,
	mode: "add",
): Promise<PersonaBody>;
async function readPersonaBody(
	req: IncomingMessage,
	mode: "update",
): Promise<PersonaUpdateBody>;
async function readPersonaBody(
	req: IncomingMessage,
	mode: "add" | "update",
): Promise<PersonaBody | PersonaUpdateBody> {
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object");
	}
	const obj = body as Record<string, unknown>;
	const instructionsRaw = obj.instructions;
	let instructions: string | undefined;
	if (instructionsRaw === undefined) {
		if (mode === "add") {
			throw new Error('Field "instructions" is required');
		}
	} else if (
		typeof instructionsRaw !== "string" ||
		instructionsRaw.length === 0
	) {
		throw new Error('Field "instructions" must be a non-empty string');
	} else {
		instructions = instructionsRaw;
	}
	const skillsRaw = obj.skills;
	let skills: Array<string> | undefined;
	if (skillsRaw === undefined) {
		skills = mode === "add" ? [] : undefined;
	} else if (skillsRaw === null) {
		throw new Error('Field "skills" must be an array');
	} else if (!Array.isArray(skillsRaw)) {
		throw new Error('Field "skills" must be an array');
	} else {
		skills = [];
		for (const item of skillsRaw) {
			if (typeof item !== "string") {
				throw new Error('Field "skills" must contain only strings');
			}
			skills.push(item);
		}
	}
	if (mode === "add") {
		return { instructions: instructions as string, skills: skills ?? [] };
	}
	return { instructions, skills };
}

function findMissingSkills(
	store: LoadedHostConfig["sqliteStore"],
	skillNames: Array<string>,
): Array<string> {
	const missing: Array<string> = [];
	for (const name of skillNames) {
		if (!store.skillExists(name)) {
			missing.push(name);
		}
	}
	return missing;
}

function writePersonaError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
