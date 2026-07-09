import type { IncomingMessage, ServerResponse } from "node:http";
import { validateResourceName } from "../data-store.js";
import { errorEnvelope, skillEnvelope } from "../envelope.js";
import { readJsonBody, readTextBody, writeJson } from "../http-utils.js";
import type { LoadedHostConfig } from "../types.js";

export function createSkillsHandler(hostConfig: LoadedHostConfig) {
	const store = hostConfig.sqliteStore;

	return {
		get(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			const skill = store.getSkill(name);
			if (skill === null) {
				writeJson(
					res,
					404,
					errorEnvelope("skill_not_found", `Skill ${name} not found`),
				);
				return;
			}
			writeJson(
				res,
				200,
				skillEnvelope({ name: skill.name, content: skill.content }),
			);
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
				validateResourceName(name, "skill name");
				const existing = store.getSkill(name);
				if (existing !== null) {
					store.updateSkill(name, { content });
				} else {
					store.createSkill({ name, content });
				}
				writeJson(res, 200, skillEnvelope({ name, content }));
			} catch (err) {
				writeSkillError(res, err);
			}
		},

		remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const name = params.name ?? "";
			if (!store.skillExists(name)) {
				writeJson(
					res,
					404,
					errorEnvelope("skill_not_found", `Skill ${name} not found`),
				);
				return;
			}
			store.deleteSkill(name);
			res.statusCode = 204;
			res.end();
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
