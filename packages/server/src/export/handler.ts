/**
 * Phase 5 — session export HTTP handler.
 *
 * Wired by `createHandler` for `POST /gateways/:name/sessions/:id/export`.
 * The route returns a `tar.gz` of the session's recording (session-meta
 * + every turn + the schema chain) built from the ocas store via
 * `@ocas/core.exportBundle`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { errorEnvelope } from "../envelope.js";
import type { SessionStore } from "../session/index.js";
import type { GatewayConfig, OcasConfig } from "../types.js";
import { buildSessionExport, streamExportResponse } from "./bundle.js";

const SOFT_NODE_CAP = 100_000;

/**
 * Handle `POST /gateways/:name/sessions/:id/export` (also `HEAD`).
 */
export async function handleSessionExport(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	path: string,
	parts: { gatewayRaw: string; idRaw: string },
	gateways: Record<string, GatewayConfig>,
	sessions: SessionStore,
	ocas: OcasConfig,
): Promise<void> {
	const gatewayName = decodePathSegment(parts.gatewayRaw);
	if (gatewayName === null) {
		writeJson(
			res,
			404,
			errorEnvelope(
				"gateway_not_found",
				`Gateway ${parts.gatewayRaw} not found`,
			),
		);
		return;
	}
	if (gateways[gatewayName] === undefined) {
		writeJson(
			res,
			404,
			errorEnvelope("gateway_not_found", `Gateway ${gatewayName} not found`),
		);
		return;
	}
	const id = decodePathSegment(parts.idRaw);
	if (id === null) {
		writeJson(
			res,
			404,
			errorEnvelope(
				"session_not_found",
				`Session ${parts.idRaw} not found on gateway ${gatewayName}`,
			),
		);
		return;
	}

	if (method !== "POST" && method !== "HEAD") {
		res.setHeader("Allow", "POST");
		writeJson(
			res,
			405,
			errorEnvelope(
				"method_not_allowed",
				`Method ${method} not allowed on ${path}`,
			),
		);
		return;
	}

	const session = sessions.get(gatewayName, id);
	if (session === null) {
		writeJson(
			res,
			404,
			errorEnvelope(
				"session_not_found",
				`Session ${id} not found on gateway ${gatewayName}`,
			),
		);
		return;
	}

	// Drain any incoming body so keep-alive works correctly. We read no fields.
	await drainBody(req);

	let exported: { tarGzPath: string; tempDir: string; nodes: number };
	try {
		exported = await buildSessionExport(session, ocas);
	} catch (err) {
		const cause = err instanceof Error ? err.message : String(err);
		writeJson(
			res,
			500,
			errorEnvelope(
				"export_failed",
				`Failed to build session export: ${truncate(cause, 500)}`,
			),
		);
		return;
	}

	if (exported.nodes > SOFT_NODE_CAP) {
		console.warn(
			`[sumeru] large export: ${session.id} nodes=${exported.nodes}`,
		);
	}

	await streamExportResponse(
		res,
		session.id,
		exported.tarGzPath,
		exported.tempDir,
		exported.nodes,
		method === "HEAD" ? "HEAD" : "POST",
	);
}

function decodePathSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

async function drainBody(req: IncomingMessage): Promise<void> {
	for await (const _chunk of req) {
		// discard
	}
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}
