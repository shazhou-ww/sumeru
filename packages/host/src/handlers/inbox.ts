import type { IncomingMessage, ServerResponse } from "node:http";
import type { OutboxFrame } from "@sumeru/core";
import { errorEnvelope, inboxAcceptedEnvelope } from "../envelope.js";
import {
	readJsonBody,
	writeJson,
	writeSseEvent,
	writeSseHeaders,
} from "../http-utils.js";
import type { InstanceManager } from "../instance-manager.js";
import { outboxFrameToSseEvent } from "../outbox.js";
import type { InboxRequest } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createInboxHandler(manager: InstanceManager) {
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
					'Body must include "messageId" and "content" strings',
				),
			);
			return;
		}
		try {
			await manager.submitInbox(id, parsed);
			writeJson(
				res,
				202,
				inboxAcceptedEnvelope({ instanceId: id, messageId: parsed.messageId }),
			);
		} catch (err) {
			writeInboxError(res, err);
		}
	};
}

export function createOutboxHandler(manager: InstanceManager) {
	return (
		_req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
	): void => {
		const id = params.id ?? "";
		writeSseHeaders(res);
		let unsubscribe: (() => void) | null = null;
		const onClose = (): void => {
			if (unsubscribe !== null) unsubscribe();
		};
		reqOnClose(_req, onClose);

		try {
			unsubscribe = manager.subscribeOutbox(id, (frame: OutboxFrame) => {
				const evt = outboxFrameToSseEvent(frame);
				writeSseEvent(res, evt.event, evt.data);
				if (frame.type === "done" || frame.type === "error") {
					res.end();
					onClose();
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			writeSseEvent(res, "error", {
				type: "error",
				value: { code: message, message },
			});
			res.end();
		}
	};
}

function parseInboxBody(body: unknown): InboxRequest | null {
	if (!isRecord(body)) return null;
	const messageId = body.messageId;
	const content = body.content;
	if (typeof messageId !== "string" || messageId.length === 0) return null;
	if (typeof content !== "string" || content.length === 0) return null;
	const projectRaw = body.project;
	if (projectRaw === undefined || projectRaw === null) {
		return { messageId, content, project: null };
	}
	if (typeof projectRaw !== "string") return null;
	return { messageId, content, project: projectRaw };
}

function writeInboxError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	switch (message) {
		case "instance_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("instance_not_found", "Instance not found"),
			);
			return;
		case "master_has_no_inbox":
			writeJson(
				res,
				400,
				errorEnvelope("invalid_request", "Master instance has no inbox"),
			);
			return;
		case "instance_not_running":
		case "adapter_unavailable":
		case "adapter_ready_timeout":
			writeJson(res, 503, errorEnvelope("adapter_unavailable", message));
			return;
		default:
			writeJson(res, 500, errorEnvelope("internal_error", message));
	}
}

function reqOnClose(req: IncomingMessage, onClose: () => void): void {
	req.on("close", onClose);
}
