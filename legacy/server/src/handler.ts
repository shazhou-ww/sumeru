import type { IncomingMessage, ServerResponse } from "node:http";
import type { Adapter, SessionConfig, Turn } from "@sumeru/core";
import { createAPI } from "./api-kit/index.js";
import {
	envelope,
	errorEnvelope,
	gatewayEnvelope,
	gatewayListEnvelope,
	instanceEnvelope,
	sessionEnvelope,
	sessionListEnvelope,
} from "./envelope.js";
import { handleSessionExport } from "./export/index.js";
import {
	handleSearchPerGateway,
	handleSearchTopLevel,
	isSearchRequest,
} from "./search/index.js";
import { resolveSessionCwd } from "./session/cwd.js";
import { createSessionStore, type SessionStore } from "./session/index.js";
import { toWire } from "./session/store.js";
import {
	handleMessageEndpoint,
	makeMessageBufferStore,
	type SseBufferStore,
} from "./sse/index.js";
import type {
	Gateway,
	GatewayConfig,
	MessageHistoryValue,
	OcasConfig,
	ServerConfig,
	Session,
	SessionListEntry,
	TurnValue,
	UserSessionConfig,
} from "./types.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;
const DEFAULT_HISTORY_LIMIT_CAP = 1000;

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
	const sessions = createSessionStore(config.ocas);
	const bufferStore = makeMessageBufferStore(config);

	const api = createAPI({
		methodNotAllowed: (res, method, path, allow) => {
			methodNotAllowed(res, method, path, allow);
		},
		notFound: (res, method, path) => {
			writeJson(
				res,
				404,
				errorEnvelope("not_found", `No route for ${method} ${path}`),
			);
		},
	});

	// GET / (root) — method-first
	api.route("GET", "/", (_req, res) => {
		writeJson(
			res,
			200,
			instanceEnvelope({
				name: config.name,
				version: config.version,
				gateways: Object.keys(config.gateways),
			}),
		);
	});

	// GET /gateways — method-first
	api.route("GET", "/gateways", (_req, res) => {
		writeJson(
			res,
			200,
			gatewayListEnvelope(
				buildGatewayList(config.gateways, config.adapters, sessions),
			),
		);
	});

	// GET /gateways/:name — method-first
	api.route("GET", "/gateways/:name", (_req, res, params, path) => {
		const nameRaw = params.name;
		if (nameRaw === undefined) {
			writeJson(
				res,
				404,
				errorEnvelope("not_found", `No route for GET ${path}`),
			);
			return;
		}
		const requested = decodePathSegment(nameRaw);
		if (requested === null) {
			writeJson(
				res,
				404,
				errorEnvelope("gateway_not_found", `Gateway ${nameRaw} not found`),
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
			gatewayEnvelope(buildGateway(requested, cfg, config.adapters, sessions)),
		);
	});

	// /gateways/:name/sessions — resource-first (handler does method check)
	api.route(
		"*",
		"/gateways/:name/sessions",
		(req, res, params, path, queryString) => {
			const gatewayRaw = params.name;
			if (gatewayRaw === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"not_found",
						`No route for ${req.method ?? "GET"} ${path}`,
					),
				);
				return;
			}
			void handleSessionsCollection(
				req,
				res,
				req.method ?? "GET",
				path,
				gatewayRaw,
				queryString,
				config,
				sessions,
			);
		},
	);

	// /gateways/:name/sessions/:id — resource-first (handler does method check)
	api.route("*", "/gateways/:name/sessions/:id", (req, res, params, path) => {
		const gatewayRaw = params.name;
		const idRaw = params.id;
		if (gatewayRaw === undefined || idRaw === undefined) {
			writeJson(
				res,
				404,
				errorEnvelope(
					"not_found",
					`No route for ${req.method ?? "GET"} ${path}`,
				),
			);
			return;
		}
		void handleSessionDetail(
			req.method ?? "GET",
			path,
			gatewayRaw,
			idRaw,
			config.gateways,
			config.adapters,
			sessions,
			res,
		);
	});

	// /gateways/:name/sessions/:id/messages — resource-first (handler does method check)
	api.route(
		"*",
		"/gateways/:name/sessions/:id/messages",
		(req, res, params, path, queryString) => {
			const gatewayRaw = params.name;
			const idRaw = params.id;
			if (gatewayRaw === undefined || idRaw === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"not_found",
						`No route for ${req.method ?? "GET"} ${path}`,
					),
				);
				return;
			}
			void handleMessages(
				req,
				res,
				req.method ?? "GET",
				path,
				{ gatewayRaw, idRaw },
				queryString,
				config,
				sessions,
				bufferStore,
			);
		},
	);

	// /gateways/:name/sessions/:id/export — resource-first (handler does method check)
	api.route(
		"*",
		"/gateways/:name/sessions/:id/export",
		(req, res, params, path) => {
			const gatewayRaw = params.name;
			const idRaw = params.id;
			if (gatewayRaw === undefined || idRaw === undefined) {
				writeJson(
					res,
					404,
					errorEnvelope(
						"not_found",
						`No route for ${req.method ?? "GET"} ${path}`,
					),
				);
				return;
			}
			void handleSessionExport(
				req,
				res,
				req.method ?? "GET",
				path,
				{ gatewayRaw, idRaw },
				config.gateways,
				sessions,
				config.ocas,
			);
		},
	);

	// GET /ocas/:hash — method-first (handler gates GET/HEAD internally)
	api.route("GET", "/ocas/:hash", (req, res, params, path) => {
		const hash = params.hash;
		if (hash === undefined) {
			writeJson(
				res,
				404,
				errorEnvelope(
					"not_found",
					`No route for ${req.method ?? "GET"} ${path}`,
				),
			);
			return;
		}
		handleOcasObject(req, res, req.method ?? "GET", path, hash, config.ocas);
	});

	// /ocas or /ocas/ — special 404 route_not_found (not generic not_found)
	api.route("*", "/ocas", (req, res, _params, path) => {
		writeJson(
			res,
			404,
			errorEnvelope(
				"route_not_found",
				`No route for ${req.method ?? "GET"} ${path}`,
			),
		);
	});

	// GET /sessions — method-first (handler gates GET/HEAD internally)
	api.route("GET", "/sessions", (_req, res, _params, _path, queryString) => {
		handleSearchTopLevel(res, queryString, config.ocas.searchIndex);
	});

	return api.handle;
}

// ─── Session collection: GET (list) / POST (create) ──────

async function handleSessionsCollection(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	path: string,
	gatewayRaw: string,
	queryString: string,
	config: ServerConfig,
	sessions: SessionStore,
): Promise<void> {
	const gateways = config.gateways;
	const adapters = config.adapters;
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

	if (method === "GET" || method === "HEAD") {
		// Phase 5: when ?q= is present and non-empty after trimming, switch
		// to the search-result envelope. Otherwise fall through to Phase-2
		// listing.
		if (isSearchRequest(queryString)) {
			handleSearchPerGateway(
				res,
				queryString,
				config.ocas.searchIndex,
				gatewayName,
			);
			return;
		}
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
		// Resolve `config.cwd` against the instance workspaceRoot BEFORE
		// invoking the adapter. The adapter sees the resolved absolute path
		// (or no `cwd` key at all when null). The original opaque blob is
		// preserved verbatim on the wire envelope and the in-memory session.
		const userConfig = configResult.value;
		const cwdResolution = resolveSessionCwd(
			config.workspaceRoot,
			(userConfig as Record<string, unknown>).cwd,
		);
		if (!cwdResolution.ok) {
			writeJson(res, 400, errorEnvelope("invalid_cwd", cwdResolution.message));
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
		const forwardedConfig = buildForwardedConfig(userConfig, cwdResolution.cwd);
		let nativeRef: Awaited<ReturnType<typeof adapter.createSession>>;
		try {
			nativeRef = await adapter.createSession(forwardedConfig);
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
		let session: Session;
		try {
			session = sessions.create(
				gatewayName,
				gatewayCfg.adapter,
				userConfig,
				nativeRef,
				cwdResolution.cwd,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			writeJson(
				res,
				500,
				errorEnvelope(
					"ocas_write_failed",
					`Failed to record session meta: ${truncate(msg, 500)}`,
				),
			);
			return;
		}
		writeJson(res, 201, sessionEnvelope(toWire(session)));
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
		writeJson(res, 200, sessionEnvelope(toWire(session)));
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
	queryString: string,
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
	if (method === "GET") {
		handleMessagesHistory(res, gatewayName, id, queryString, config, sessions);
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

/**
 * GET /gateways/:name/sessions/:id/messages — return the full ordered turn
 * sequence sourced from ocas via the per-session `turnHashes` pointer.
 */
function handleMessagesHistory(
	res: ServerResponse,
	gatewayName: string,
	id: string,
	queryString: string,
	config: ServerConfig,
	sessions: SessionStore,
): void {
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
	const params = new URLSearchParams(queryString);
	const offsetRes = parseNonNegInt(params.get("offset"), "offset");
	if (!offsetRes.ok) {
		writeJson(res, 400, errorEnvelope("invalid_request", offsetRes.message));
		return;
	}
	const limitRes = parseNonNegInt(params.get("limit"), "limit");
	if (!limitRes.ok) {
		writeJson(res, 400, errorEnvelope("invalid_request", limitRes.message));
		return;
	}
	const total = session.turnHashes.length;
	const offset = offsetRes.value ?? 0;
	const requestedLimit = limitRes.value ?? Math.max(0, total - offset);
	const limit = Math.min(requestedLimit, DEFAULT_HISTORY_LIMIT_CAP);
	const slice = session.turnHashes.slice(offset, offset + limit);
	const turns: TurnValue[] = [];
	for (const h of slice) {
		const node = config.ocas.store.cas.get(h);
		if (node === null) continue;
		const payload = node.payload as Turn;
		turns.push({ ...payload, hash: h });
	}
	const value: MessageHistoryValue = {
		sessionId: session.id,
		gateway: session.gateway,
		total,
		offset,
		limit,
		turns,
	};
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	const payload = JSON.stringify(envelope("@sumeru/message-history", value));
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}

type ParsedNonNegInt =
	| { ok: true; value: number | null }
	| { ok: false; message: string };

function parseNonNegInt(raw: string | null, name: string): ParsedNonNegInt {
	if (raw === null) return { ok: true, value: null };
	const trimmed = raw.trim();
	if (trimmed.length === 0 || !/^[0-9]+$/.test(trimmed)) {
		return {
			ok: false,
			message: `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
		};
	}
	const n = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(n) || n < 0) {
		return {
			ok: false,
			message: `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
		};
	}
	return { ok: true, value: n };
}

// ─── /ocas/:hash endpoint ────────────────────────────────

function handleOcasObject(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	path: string,
	hash: string,
	ocas: OcasConfig,
): void {
	if (method !== "GET" && method !== "HEAD") {
		methodNotAllowed(res, method, path, "GET");
		return;
	}
	if (!HASH_RE.test(hash)) {
		writeJson(
			res,
			400,
			errorEnvelope(
				"invalid_hash",
				`Hash must be a 13-character Crockford Base32 string (got '${hash}')`,
			),
		);
		return;
	}
	const node = ocas.store.cas.get(hash);
	if (node === null) {
		writeJson(
			res,
			404,
			errorEnvelope("ocas_not_found", `No ocas node found for hash '${hash}'`),
		);
		return;
	}
	const ifNoneMatch = req.headers["if-none-match"];
	if (
		typeof ifNoneMatch === "string" &&
		ifNoneMatch.replace(/"/g, "") === hash
	) {
		res.statusCode = 304;
		res.setHeader("ETag", `"${hash}"`);
		res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
		res.end();
		return;
	}
	const typeName = ocas.schemaAliases[node.type] ?? node.type;
	const body = JSON.stringify({ type: typeName, value: node.payload });
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("ETag", `"${hash}"`);
	res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
	res.setHeader("Content-Length", Buffer.byteLength(body).toString());
	res.end(body);
}

// ─── Helpers ─────────────────────────────────────────────

function decodePathSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

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
	| { ok: true; value: UserSessionConfig }
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
	return { ok: true, value: raw as UserSessionConfig };
}

/**
 * Build the opaque config blob the adapter will see.
 *
 * The user-supplied `cwd` (if any) is replaced with the server-resolved
 * absolute path. When `resolvedCwd` is `null` (no cwd hint), the `cwd` key is
 * removed entirely so adapters can fall back to their constructor / process
 * default. Extracts `model` and `cwd` into the core `SessionConfig` shape.
 */
function buildForwardedConfig(
	original: UserSessionConfig,
	resolvedCwd: string | null,
): SessionConfig {
	const model =
		typeof original.model === "string" && original.model.length > 0
			? original.model
			: null;
	const cwd = resolvedCwd;
	return { model, cwd };
}
