import type { KnownProvider } from "@sumeru/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope, messageAcceptedEnvelope } from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import { generateMessageId } from "../id.js";
import type { SessionManager } from "../session-manager.js";
import type { MessageBody, MessageRequest } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMessagesHandler(manager: SessionManager) {
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
		const parsed = parseMessageBody(body);
		if (parsed === null) {
			writeJson(
				res,
				400,
				errorEnvelope(
					"invalid_request",
					'Body must include a non-empty "content" string',
				),
			);
			return;
		}
		const messageId = generateMessageId();
		const request: MessageRequest = { ...parsed, messageId };
		try {
			await manager.submitMessage(id, request);
			writeJson(res, 202, messageAcceptedEnvelope({ sessionId: id, messageId }));
		} catch (err) {
			writeMessagesError(res, err);
		}
	};
}

function parseMessageBody(body: unknown): MessageBody | null {
	if (!isRecord(body)) return null;
	const content = body.content;
	if (typeof content !== "string" || content.length === 0) return null;

	const envRaw = body.env;
	let env: Record<string, string> | null = null;
	if (envRaw !== undefined && envRaw !== null) {
		if (!isRecord(envRaw)) return null;
		env = {};
		for (const [key, value] of Object.entries(envRaw)) {
			if (typeof value !== "string") return null;
			env[key] = value;
		}
	}

	const modelRaw = body.model;
	let model: MessageBody["model"] = null;
	if (modelRaw !== undefined && modelRaw !== null) {
		if (!isRecord(modelRaw)) return null;
		const provider = modelRaw.provider;
		const name = modelRaw.name;
		if (typeof name !== "string" || name.length === 0) return null;
		if (typeof provider === "string") {
			model = { provider: provider as KnownProvider, name };
		} else if (isRecord(provider)) {
			const providerName = provider.name;
			const endpoint = provider.endpoint;
			const apiType = provider.apiType;
			if (
				typeof providerName !== "string" ||
				typeof endpoint !== "string" ||
				(apiType !== "openai" && apiType !== "anthropic")
			) {
				return null;
			}
			model = {
				provider: { name: providerName, endpoint, apiType },
				name,
			};
		} else {
			return null;
		}
	}

	return { content, env, model };
}

function writeMessagesError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
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
		case "session_not_running":
		case "adapter_unavailable":
		case "adapter_ready_timeout":
			writeJson(res, 503, errorEnvelope("adapter_unavailable", message));
			return;
		default:
			writeJson(res, 500, errorEnvelope("internal_error", message));
	}
}
