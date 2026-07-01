import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelConfig } from "@sumeru/core";
import {
	errorEnvelope,
	sessionEnvelope,
	sessionListEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { SessionManager } from "../session-manager.js";
import type { CreateSessionRequest, ManagedSession } from "../types.js";

function toSessionInfo(record: ManagedSession) {
	return {
		id: record.id,
		prototype: record.prototype,
		model: record.model,
		image: record.image,
		project: record.project,
		task: record.task,
		status: record.status,
		exit: record.exit,
		createdAt: record.createdAt,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSessionsHandler(manager: SessionManager) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, sessionListEnvelope(manager.listSessions()));
		},

		detail(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): void {
			const id = params.id ?? "";
			const record = manager.getSession(id);
			if (record === null) {
				writeJson(
					res,
					404,
					errorEnvelope("session_not_found", `Session ${id} not found`),
				);
				return;
			}
			writeJson(res, 200, sessionEnvelope(toSessionInfo(record)));
		},

		async create(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
			const parsed = parseCreateBody(body);
			if (parsed === null) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_request",
						'Body must include non-empty string fields "prototype", "project", and "task"',
					),
				);
				return;
			}
			try {
				const created = await manager.createSession(parsed);
				writeJson(res, 201, sessionEnvelope(toSessionInfo(created)));
			} catch (err) {
				writeSessionError(res, err);
			}
		},

		async stop(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			try {
				const stopped = await manager.stopSession(params.id ?? "");
				writeJson(res, 200, sessionEnvelope(toSessionInfo(stopped)));
			} catch (err) {
				writeSessionError(res, err);
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			try {
				await manager.deleteSession(params.id ?? "");
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writeSessionError(res, err);
			}
		},
	};
}

function parseCreateBody(body: unknown): CreateSessionRequest | null {
	if (!isRecord(body)) return null;
	const prototype = body.prototype;
	const project = body.project;
	const task = body.task;
	if (typeof prototype !== "string" || prototype.length === 0) return null;
	if (typeof project !== "string" || project.length === 0) return null;
	if (typeof task !== "string" || task.length === 0) return null;

	const model = parseModelBody(body.model);
	if (model === "invalid") return null;

	const envRaw = body.env;
	if (envRaw === undefined || envRaw === null) {
		return { prototype, project, task, model, env: null };
	}
	if (!isRecord(envRaw)) return null;
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(envRaw)) {
		if (typeof value !== "string") return null;
		env[key] = value;
	}
	return { prototype, project, task, model, env };
}

function parseModelBody(
	value: unknown,
): CreateSessionRequest["model"] | "invalid" {
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

function writeSessionError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	if (message.startsWith("invalid_project:")) {
		writeJson(
			res,
			400,
			errorEnvelope(
				"invalid_project",
				message.slice("invalid_project:".length),
			),
		);
		return;
	}
	switch (message) {
		case "prototype_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("prototype_not_found", "Prototype not found"),
			);
			return;
		case "session_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("session_not_found", "Session not found"),
			);
			return;
		case "session_already_idle":
			writeJson(
				res,
				409,
				errorEnvelope("session_already_idle", "Session is already idle"),
			);
			return;
		case "prototype_no_compose":
			writeJson(
				res,
				400,
				errorEnvelope(
					"prototype_no_compose",
					"Prototype has no legacy compose.yaml for Docker workers",
				),
			);
			return;
		default:
			writeJson(res, 500, errorEnvelope("internal_error", message));
	}
}
