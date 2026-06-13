import type { IncomingMessage, ServerResponse } from "node:http";
import type { Adapter } from "@sumeru/core";
import {
	errorEnvelope,
	gatewayEnvelope,
	gatewayListEnvelope,
	instanceEnvelope,
	sessionEnvelope,
	sessionListEnvelope,
} from "./envelope.js";
import { createSessionStore, type SessionStore } from "./session/index.js";
import {
	handleMessageEndpoint,
	makeMessageBufferStore,
	type SseBufferStore,
} from "./sse/index.js";
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
 * Phase 3 routes:
 *   POST   /gateways/:name/sessions/:id/messages  → SSE (turn / heartbeat / done / error)
 *
 * All non-success bodies are `@sumeru/error` envelopes. Method mismatches
 * return 405 with a populated `Allow` header.
 */
export function createHandler(
	config: ServerConfig,
): (req: IncomingMessage, res: ServerResponse) => void {
	const sessions = createSessionStore();
	const bufferStore = makeMessageBufferStore(config);

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
					gatewayListEnvelope(
						buildGatewayList(config.gateways, config.adapters, sessions),
					),
				);
				return;
			}
			methodNotAllowed(res, method, path, "GET");
			return;
		}

		// /gateways/<name>/sessions/<id>/messages
		const messagesMatch = matchSessionMessages(path);
		if (messagesMatch !== null) {
			void handleMessages(
				req,
				res,
				method,
				path,
				messagesMatch,
				config,
				sessions,
				bufferStore,
			);
			return;
		}

		// /gateways/<name>/sessions/<id> (and trailing slash variants)
		const sessionDetail = matchSessionDetail(path);
		if (sessionDetail !== null) {
			void handleSessionDetail(
				method,
				path,
				sessionDetail.gatewayRaw,
				sessionDetail.idRaw,
				config.gateways,
				config.adapters,
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
				config.adapters,
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
				gatewayEnvelope(
					buildGateway(requested, cfg, config.adapters, sessions),
				),
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

/** Match `/gateways/<name>/sessions/<id>/messages` (with optional trailing slash). */
function matchSessionMessages(
	path: string,
): { gatewayRaw: string; idRaw: string } | null {
	const prefix = "/gateways/";
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	const stripped = rest.endsWith("/") ? rest.slice(0, -1) : rest;
	const parts = stripped.split("/");
	if (parts.length !== 4) return null;
	const [gatewayRaw, sessionsLiteral, idRaw, messagesLiteral] = parts;
	if (gatewayRaw === undefined || sessionsLiteral !== "sessions") return null;
	if (idRaw === undefined || idRaw.length === 0) return null;
	if (messagesLiteral !== "messages") return null;
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
	adapters: Record<string, Adapter>,
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
	const gatewayCfg = gateways[gatewayName];
	if (gatewayCfg === undefined) {
		// 404 for unknown gateway is reported even on disallowed methods so
		// callers see the most-specific failure (gateway_not_found, not 405).
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
		const adapter = adapters[gatewayCfg.adapter];
		if (adapter === undefined) {
			writeJson(
				res,
				503,
				errorEnvelope(
					"adapter_unavailable",
					`Adapter '${gatewayCfg.adapter}' for gateway '${gatewayName}' is not registered`,
				),
			);
			return;
		}
		let nativeRef: Awaited<ReturnType<typeof adapter.createSession>>;
		try {
			nativeRef = await adapter.createSession(configResult.value);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const isTimeout = /timed out/i.test(msg);
			writeJson(
				res,
				isTimeout ? 504 : 502,
				errorEnvelope(
					isTimeout ? "adapter_timeout" : "adapter_error",
					`${gatewayName} adapter failed: ${truncate(msg, 500)}`,
				),
			);
			return;
		}
		const session = sessions.create(gatewayName, configResult.value, nativeRef);
		writeJson(res, 201, sessionEnvelope(session));
		return;
	}
	methodNotAllowed(res, method, path, "GET, POST");
}

// ─── Session detail: GET / DELETE ────────────────────────

async function handleSessionDetail(
	method: string,
	path: string,
	gatewayRaw: string,
	idRaw: string,
	gateways: Record<string, GatewayConfig>,
	adapters: Record<string, Adapter>,
	sessions: SessionStore,
	res: ServerResponse,
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
	const gatewayCfg = gateways[gatewayName];
	if (gatewayCfg === undefined) {
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
		const existing = sessions.get(gatewayName, id);
		if (existing === null) {
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
		const nativeRef = sessions.getNativeRef(gatewayName, id);
		const adapter = adapters[gatewayCfg.adapter];
		if (
			nativeRef !== null &&
			adapter !== undefined &&
			existing.status !== "closed"
		) {
			try {
				await adapter.close(nativeRef);
			} catch {
				// Adapter close failure does NOT fail the HTTP DELETE — the
				// session is logically dead in Sumeru regardless.
			}
		}
		// `closed` and `already_closed` both return 204 (idempotent).
		sessions.close(gatewayName, id);
		writeNoContent(res);
		return;
	}
	methodNotAllowed(res, method, path, "GET, DELETE");
}

// ─── Messages endpoint ───────────────────────────────────

async function handleMessages(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	path: string,
	parts: { gatewayRaw: string; idRaw: string },
	config: ServerConfig,
	sessions: SessionStore,
	bufferStore: SseBufferStore,
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
	if (config.gateways[gatewayName] === undefined) {
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
	if (method !== "POST") {
		methodNotAllowed(res, method, path, "GET, POST");
		return;
	}
	await handleMessageEndpoint(req, res, gatewayName, id, {
		sessions,
		adapters: config.adapters,
		config,
		bufferStore,
	});
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
	adapters: Record<string, Adapter>,
	sessions: SessionStore,
): Gateway[] {
	const entries: Gateway[] = [];
	for (const [name, cfg] of Object.entries(gateways)) {
		entries.push(buildGateway(name, cfg, adapters, sessions));
	}
	return entries;
}

function buildGateway(
	name: string,
	cfg: GatewayConfig,
	adapters: Record<string, Adapter>,
	sessions: SessionStore,
): Gateway {
	return {
		name,
		adapter: cfg.adapter,
		status: adapters[cfg.adapter] !== undefined ? "ready" : "unavailable",
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

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
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
