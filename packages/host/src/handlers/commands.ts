import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelConfig } from "@sumeru/core";
import {
	commandAcceptedEnvelope,
	commandResultEnvelope,
	errorEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";
import type { SessionCommand, SessionModelOverride } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createCommandsHandler(manager: SessionManager) {
	return async (
		req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
	): Promise<void> => {
		const id = params.id ?? "";
		let body: unknown;
		try {
			body = await readJsonBody(req);
		} catch {
			writeJson(
				res,
				400,
				errorEnvelope("invalid_json", "Request body must be valid JSON"),
			);
			return;
		}
		const parsed = parseSessionCommand(body);
		if (parsed === null) {
			writeJson(
				res,
				400,
				errorEnvelope(
					"invalid_request",
					'Body must include a valid "type" command',
				),
			);
			return;
		}
		try {
			const result = await manager.runCommand(id, parsed);
			if (result.mode === "async") {
				writeJson(res, 202, commandAcceptedEnvelope(result.value));
				return;
			}
			writeJson(res, 200, commandResultEnvelope(result.value));
		} catch (err) {
			writeCommandsError(res, err);
		}
	};
}

function parseSessionCommand(body: unknown): SessionCommand | null {
	if (!isRecord(body)) return null;
	const type = body.type;
	if (typeof type !== "string") return null;

	switch (type) {
		case "chat": {
			const content = body.content;
			if (typeof content !== "string" || content.length === 0) return null;
			const messageIdRaw = body.messageId;
			const messageId =
				messageIdRaw === undefined || messageIdRaw === null
					? null
					: typeof messageIdRaw === "string" && messageIdRaw.length > 0
						? messageIdRaw
						: null;
			if (
				messageIdRaw !== undefined &&
				messageIdRaw !== null &&
				messageId === null
			) {
				return null;
			}
			const env = parseEnvBody(body.env);
			if (env === "invalid") return null;
			const model = parseModelBody(body.model);
			if (model === "invalid") return null;
			return { type: "chat", content, messageId, env, model };
		}
		case "exec": {
			const command = body.command;
			if (typeof command !== "string" || command.length === 0) return null;
			return { type: "exec", command };
		}
		case "model": {
			const provider = body.provider;
			const model = body.model;
			if (typeof provider !== "string" || provider.length === 0) return null;
			if (typeof model !== "string" || model.length === 0) return null;
			return { type: "model", provider, model };
		}
		case "install-skill": {
			const name = body.name;
			if (typeof name !== "string" || name.length === 0) return null;
			const contentRaw = body.content;
			const content =
				contentRaw === undefined || contentRaw === null
					? null
					: typeof contentRaw === "string"
						? contentRaw
						: null;
			if (contentRaw !== undefined && contentRaw !== null && content === null) {
				return null;
			}
			const files = parseSkillFiles(body.files);
			if (files === "invalid") return null;
			return { type: "install-skill", name, content, files };
		}
		case "reset": {
			const personaRaw = body.persona;
			if (personaRaw === undefined || personaRaw === null) {
				return { type: "reset", persona: null };
			}
			if (typeof personaRaw !== "string") return null;
			return { type: "reset", persona: personaRaw };
		}
		case "snapshot": {
			const name = body.name;
			if (typeof name !== "string" || name.length === 0) return null;
			return { type: "snapshot", name };
		}
		default:
			return null;
	}
}

function parseEnvBody(
	value: unknown,
): Record<string, string> | null | "invalid" {
	if (value === undefined || value === null) {
		return null;
	}
	if (!isRecord(value)) return "invalid";
	const env: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") return "invalid";
		env[key] = entry;
	}
	return env;
}

function parseModelBody(value: unknown): SessionModelOverride | "invalid" {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value.length > 0 ? value : "invalid";
	}
	if (!isRecord(value)) return "invalid";
	const name = value.name;
	if (typeof name !== "string" || name.length === 0) return "invalid";
	const provider = parseProvider(value.provider);
	if (provider === "invalid") return "invalid";
	return { provider, name };
}

function parseProvider(value: unknown): ModelConfig["provider"] | "invalid" {
	if (typeof value === "string") {
		if (value === "anthropic" || value === "openai" || value === "openrouter") {
			return value;
		}
		return "invalid";
	}
	if (!isRecord(value)) return "invalid";
	const name = value.name;
	const endpoint = value.endpoint;
	const apiType = value.apiType;
	if (typeof name !== "string" || name.length === 0) return "invalid";
	if (typeof endpoint !== "string" || endpoint.length === 0) return "invalid";
	if (apiType !== "openai" && apiType !== "anthropic") return "invalid";
	return { name, endpoint, apiType };
}

function parseSkillFiles(
	value: unknown,
): Array<{ path: string; content: string }> | null | "invalid" {
	if (value === undefined || value === null) {
		return null;
	}
	if (!Array.isArray(value)) return "invalid";
	const files: Array<{ path: string; content: string }> = [];
	for (const item of value) {
		if (!isRecord(item)) return "invalid";
		const path = item.path;
		const content = item.content;
		if (typeof path !== "string" || path.length === 0) return "invalid";
		if (typeof content !== "string") return "invalid";
		files.push({ path, content });
	}
	return files;
}

function writeCommandsError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	if (message.startsWith("model_not_found:")) {
		writeJson(
			res,
			404,
			errorEnvelope(
				"model_not_found",
				message.slice("model_not_found:".length),
			),
		);
		return;
	}
	if (message.startsWith("model_invalid_format:")) {
		writeJson(
			res,
			400,
			errorEnvelope(
				"model_invalid_format",
				message.slice("model_invalid_format:".length),
			),
		);
		return;
	}
	switch (message) {
		case "session_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("session_not_found", "Session not found"),
			);
			return;
		case "session_busy":
			writeJson(
				res,
				409,
				errorEnvelope("session_busy", "Session is already running"),
			);
			return;
		case "skill_not_found":
			writeJson(res, 404, errorEnvelope("skill_not_found", "Skill not found"));
			return;
		case "prototype_exists":
			writeJson(
				res,
				409,
				errorEnvelope(
					"prototype_exists",
					"A prototype with this name already exists",
				),
			);
			return;
		case "session_not_running":
		case "adapter_unavailable":
		case "adapter_ready_timeout":
			writeJson(res, 503, errorEnvelope("adapter_unavailable", message));
			return;
		default:
			writeJson(res, 500, errorEnvelope("internal_error", message));
	}
}
