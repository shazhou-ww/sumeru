import type { IncomingMessage, ServerResponse } from "node:http";
import {
	errorEnvelope,
	gatewayEnvelope,
	gatewayListEnvelope,
	instanceEnvelope,
	sessionEnvelope,
	sessionListEnvelope,
} from "./envelope.js";
import { createSessionStore, type SessionStore } from "./session/index.js";
import type {
	Gateway,
	GatewayConfig,
	ServerConfig,
	Session,
	SessionConfig,
	SessionListEntry,
} from "./types.js";

/**
 * Build the request handler for a server with the given config.
 *
 * Phase 1 routes:
 *   GET    /                           → 200 @sumeru/instance envelope
 *   GET    /gateways                   → 200 @sumeru/gateway-list envelope
 *   GET    /gateways/:name             → 200 @sumeru/gateway envelope OR 404
 *
 * Phase 2 routes:
 *   POST   /gateways/:name/sessions    → 201 @sumeru/session envelope OR 400/404
 *   GET    /gateways/:name/sessions    → 200 @sumeru/session-list envelope OR 404
 *   GET    /gateways/:name/sessions/:id    → 200 @sumeru/session OR 404
 *   DELETE /gateways/:name/sessions/:id    → 204 No Content OR 404
 *
 * All non-success bodies are `@sumeru/error` envelopes. Method mismatches
 * return 405 with a populated `Allow` header.
 */
export function createHandler(
	config: ServerConfig,
): (req: IncomingMessage, res: ServerResponse) => void {
	const sessions = createSessionStore();

	return (req, res) => {
		const method = req.method ?? "GET";
		const url = req.url ?? "/";
		const path = stripQueryString(url);

		// GET /  (root)
		if (path === "/") {
			if (method === "GET") {
				writeJson(
					res,
					200,
					instanceEnvelope({
						name: config.name,
						version: config.version,
						gateways: Object.keys(config.gateways),
					}),
				);
				return;
			}
			methodNotAllowed(res, method, path, "GET");
			return;
		}

		// /gateways or /gateways/
		if (path === "/gateways" || path === "/gateways/") {
			if (method === "GET") {
				writeJson(
					res,
					200,
					gatewayListEnvelope(buildGatewayList(config.gateways, sessions)),
				);
				return;
			}
			methodNotAllowed(res, method, path, "GET");
			return;
		}

		// /gateways/<name>/sessions/<id> (and trailing slash variants)
		const sessionDetail = matchSessionDetail(path);
		if (sessionDetail !== null) {
			handleSessionDetail(
				method,
				path,
				sessionDetail.gatewayRaw,
				sessionDetail.idRaw,
				config.gateways,
				sessions,
				res,
			);
			return;
		}

		// /gateways/<name>/sessions or /gateways/<name>/sessions/
		const sessionsCollection = matchSessionsCollection(path);
		if (sessionsCollection !== null) {
			void handleSessionsCollection(
				req,
				res,
				method,
				path,
				sessionsCollection,
				config.gateways,
				sessions,
			);
			return;
		}

		// /gateways/<name> or /gateways/<name>/
		const detailMatch = matchGatewayDetail(path);
		if (detailMatch !== null) {
			if (method !== "GET") {
				methodNotAllowed(res, method, path, "GET");
				return;
			}
			const requested = decodePathSegment(detailMatch);
			if (requested === null) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"gateway_not_found",
						`Gateway ${detailMatch} not found`,
					),
				);
				return;
			}
			const cfg = config.gateways[requested];
			if (cfg === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope("gateway_not_found", `Gateway ${requested} not found`),
				);
				return;
			}
			writeJson(
				res,
				200,
				gatewayEnvelope(buildGateway(requested, cfg, sessions)),
			);
			return;
		}

		// Unknown path
		writeJson(
			res,
			404,
			errorEnvelope("not_found", `No route for ${method} ${path}`),
		);
	};
}

// ─── Path matchers ───────────────────────────────────────

function stripQueryString(url: string): string {
	const q = url.indexOf("?");
	return q === -1 ? url : url.slice(0, q);
}

function matchGatewayDetail(path: string): string | null {
	const prefix = "/gateways/";
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	if (rest.length === 0) return null;
	const trimmed = rest.endsWith("/") ? rest.slice(0, -1) : rest;
	if (trimmed.length === 0) return null;
	if (trimmed.includes("/")) return null;
	return trimmed;
}

/**
 * Match `/gateways/<name>/sessions` (with optional trailing slash).
 * Returns the raw (still URL-encoded) gateway name, or null if no match.
 */
function matchSessionsCollection(path: string): string | null {
	const prefix = "/gateways/";
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	const stripped = rest.endsWith("/") ? rest.slice(0, -1) : rest;
	if (!stripped.endsWith("/sessions")) return null;
	const gatewayRaw = stripped.slice(0, -"/sessions".length);
	if (gatewayRaw.length === 0) return null;
	if (gatewayRaw.includes("/")) return null;
	return gatewayRaw;
}

/**
 * Match `/gateways/<name>/sessions/<id>` (with optional trailing slash).
 * Returns raw (still URL-encoded) segments, or null.
 */
function matchSessionDetail(
	path: string,
): { gatewayRaw: string; idRaw: string } | null {
	const prefix = "/gateways/";
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	const stripped = rest.endsWith("/") ? rest.slice(0, -1) : rest;
	const parts = stripped.split("/");
	if (parts.length !== 3) return null;
	const [gatewayRaw, sessionsLiteral, idRaw] = parts;
	if (gatewayRaw === undefined || sessionsLiteral !== "sessions") return null;
	if (idRaw === undefined || idRaw.length === 0) return null;
	if (gatewayRaw.length === 0) return null;
	return { gatewayRaw, idRaw };
}

function decodePathSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

// ─── Session collection: GET (list) / POST (create) ──────

async function handleSessionsCollection(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	path: string,
	gatewayRaw: string,
	gateways: Record<string, GatewayConfig>,
	sessions: SessionStore,
): Promise<void> {
	const gatewayName = decodePathSegment(gatewayRaw);
	if (gatewayName === null) {
		writeJson(
			res,
			404,
			errorEnvelope("gateway_not_found", `Gateway ${gatewayRaw} not found`),
		);
		return;
	}
	if (gateways[gatewayName] === undefined) {
		// 404 for unknown gateway is reported even on disallowed methods so
		// callers see the most-specific failure (gateway_not_found, not 405).
		// However the spec for the create/list endpoint reports 405 for PATCH/PUT
		// against a known gateway; for unknown gateways we still 404 first.
		writeJson(
			res,
			404,
			errorEnvelope("gateway_not_found", `Gateway ${gatewayName} not found`),
		);
		return;
	}

	if (method === "GET") {
		const list: SessionListEntry[] = sessions.list(gatewayName).map(toEntry);
		writeJson(res, 200, sessionListEnvelope(list));
		return;
	}
	if (method === "POST") {
		const parsed = await readJsonBody(req);
		if (!parsed.ok) {
			writeJson(res, 400, errorEnvelope(parsed.error, parsed.message));
			return;
		}
		const body = parsed.value;
		const configResult = extractConfig(body);
		if (!configResult.ok) {
			writeJson(
				res,
				400,
				errorEnvelope(configResult.error, configResult.message),
			);
			return;
		}
		const session = sessions.create(gatewayName, configResult.value);
		writeJson(res, 201, sessionEnvelope(session));
		return;
	}
	methodNotAllowed(res, method, path, "GET, POST");
}

// ─── Session detail: GET / DELETE ────────────────────────

function handleSessionDetail(
	method: string,
	path: string,
	gatewayRaw: string,
	idRaw: string,
	gateways: Record<string, GatewayConfig>,
	sessions: SessionStore,
	res: ServerResponse,
): void {
	const gatewayName = decodePathSegment(gatewayRaw);
	if (gatewayName === null) {
		writeJson(
			res,
			404,
			errorEnvelope("gateway_not_found", `Gateway ${gatewayRaw} not found`),
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
	const id = decodePathSegment(idRaw);
	if (id === null) {
		writeJson(
			res,
			404,
			errorEnvelope(
				"session_not_found",
				`Session ${idRaw} not found on gateway ${gatewayName}`,
			),
		);
		return;
	}

	if (method === "GET") {
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
		writeJson(res, 200, sessionEnvelope(session));
		return;
	}
	if (method === "DELETE") {
		const result = sessions.close(gatewayName, id);
		if (result === "not_found") {
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
		// `closed` and `already_closed` both return 204 (idempotent).
		writeNoContent(res);
		return;
	}
	methodNotAllowed(res, method, path, "GET, DELETE");
}

// ─── Helpers ─────────────────────────────────────────────

function methodNotAllowed(
	res: ServerResponse,
	method: string,
	path: string,
	allow: string,
): void {
	res.setHeader("Allow", allow);
	writeJson(
		res,
		405,
		errorEnvelope(
			"method_not_allowed",
			`Method ${method} not allowed on ${path}`,
		),
	);
}

function buildGatewayList(
	gateways: Record<string, GatewayConfig>,
	sessions: SessionStore,
): Gateway[] {
	const entries: Gateway[] = [];
	for (const [name, cfg] of Object.entries(gateways)) {
		entries.push(buildGateway(name, cfg, sessions));
	}
	return entries;
}

function buildGateway(
	name: string,
	cfg: GatewayConfig,
	sessions: SessionStore,
): Gateway {
	return {
		name,
		adapter: cfg.adapter,
		status: "ready",
		activeSessions: sessions.activeCount(name),
		capabilities: {
			resume: cfg.capabilities.resume,
			streaming: cfg.capabilities.streaming,
		},
	};
}

function toEntry(session: Session): SessionListEntry {
	return {
		id: session.id,
		gateway: session.gateway,
		status: session.status,
		createdAt: session.createdAt,
	};
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}

function writeNoContent(res: ServerResponse): void {
	res.statusCode = 204;
	// 204 must not have a body. Removing Content-Type is conventional.
	res.removeHeader("Content-Type");
	res.setHeader("Content-Length", "0");
	res.end();
}

// ─── JSON body parsing ───────────────────────────────────

type ReadBodyResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; error: string; message: string };

async function readJsonBody(req: IncomingMessage): Promise<ReadBodyResult> {
	const chunks: Buffer[] = [];
	let total = 0;
	const MAX = 1024 * 1024; // 1 MiB cap; well above any reasonable session config.
	for await (const chunk of req) {
		const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as string);
		total += buf.length;
		if (total > MAX) {
			return {
				ok: false,
				error: "invalid_request",
				message: "Request body too large",
			};
		}
		chunks.push(buf);
	}
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (raw.length === 0) {
		return { ok: true, value: {} };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: "invalid_json",
			message: `Request body is not valid JSON: ${detail}`,
		};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			ok: false,
			error: "invalid_request",
			message: "Request body must be a JSON object",
		};
	}
	return { ok: true, value: parsed as Record<string, unknown> };
}

type ConfigResult =
	| { ok: true; value: SessionConfig }
	| { ok: false; error: string; message: string };

function extractConfig(body: Record<string, unknown>): ConfigResult {
	if (!("config" in body)) {
		return { ok: true, value: {} };
	}
	const raw = body.config;
	if (raw === undefined || raw === null) {
		return { ok: true, value: {} };
	}
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return {
			ok: false,
			error: "invalid_request",
			message: "Field 'config' must be a JSON object when provided",
		};
	}
	return { ok: true, value: raw as SessionConfig };
}
