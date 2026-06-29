import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope, inboxAcceptedEnvelope } from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import { generateMessageId } from "../id.js";
import type { SessionManager } from "../session-manager.js";
import type { InboxBody, InboxRequest } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createInboxHandler(manager: SessionManager) {
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
		const parsed = parseInboxBody(body);
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
		const request: InboxRequest = { ...parsed, messageId };
		try {
			await manager.submitInbox(id, request);
			writeJson(res, 202, inboxAcceptedEnvelope({ sessionId: id, messageId }));
		} catch (err) {
			writeInboxError(res, err);
		}
	};
}

function parseInboxBody(body: unknown): InboxBody | null {
	if (!isRecord(body)) return null;
	const content = body.content;
	if (typeof content !== "string" || content.length === 0) return null;
	const projectRaw = body.project;
	if (projectRaw === undefined || projectRaw === null) {
		return { content, project: null };
	}
	if (typeof projectRaw !== "string") return null;
	return { content, project: projectRaw };
}

function writeInboxError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	switch (message) {
		case "session_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("session_not_found", "Session not found"),
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
