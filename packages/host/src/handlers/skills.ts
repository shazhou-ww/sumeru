import type { IncomingMessage, ServerResponse } from "node:http";
import {
	deleteSkill,
	findPrototypeReferencesToSkill,
	readSkill,
	skillExists,
	writeSkill,
} from "../data-store.js";
import { errorEnvelope, skillEnvelope } from "../envelope.js";
import { readJsonBody, readTextBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createSkillsHandler(hostConfig: LoadedHostConfig) {
	return {
		async get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (!(await skillExists(hostConfig.skillsDir, name))) {
				writeJson(
					res,
					404,
					errorEnvelope("skill_not_found", `Skill ${name} not found`),
				);
				return;
			}
			try {
				const content = await readSkill(hostConfig.skillsDir, name);
				writeJson(res, 200, skillEnvelope({ name, content }));
			} catch (err) {
				writeSkillError(res, err);
			}
		},

		async put(
			req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			let content: string;
			try {
				content = await readSkillBody(req);
			} catch {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_body",
						"Skill body must be plain text or JSON { content: string }",
					),
				);
				return;
			}
			try {
				await writeSkill(hostConfig.skillsDir, name, content);
				writeJson(res, 200, skillEnvelope({ name, content }));
			} catch (err) {
				writeSkillError(res, err);
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const name = params.name ?? "";
			if (!(await skillExists(hostConfig.skillsDir, name))) {
				writeJson(
					res,
					404,
					errorEnvelope("skill_not_found", `Skill ${name} not found`),
				);
				return;
			}
			try {
				const references = await findPrototypeReferencesToSkill(
					hostConfig.prototypesDir,
					name,
				);
				if (references.length > 0) {
					writeJson(
						res,
						409,
						errorEnvelope(
							"skill_referenced",
							`Skill ${name} is referenced by prototypes: ${references.join(", ")}`,
						),
					);
					return;
				}
				await deleteSkill(hostConfig.skillsDir, name);
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writeSkillError(res, err);
			}
		},
	};
}

async function readSkillBody(req: IncomingMessage): Promise<string> {
	const contentType = req.headers["content-type"] ?? "";
	if (contentType.includes("application/json")) {
		const body = await readJsonBody(req);
		if (
			typeof body === "object" &&
			body !== null &&
			"content" in body &&
			typeof (body as { content: unknown }).content === "string"
		) {
			return (body as { content: string }).content;
		}
		throw new Error("invalid_body");
	}
	return readTextBody(req);
}

function writeSkillError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	if (message.includes("must match")) {
		writeJson(res, 400, errorEnvelope("invalid_name", message));
		return;
	}
	writeJson(res, 500, errorEnvelope("internal_error", message));
}
