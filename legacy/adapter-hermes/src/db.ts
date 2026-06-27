/**
 * Read-only Hermes session-DB turn reader.
 *
 * Supports two schemas, detected at read time:
 *   - Schema v1 (`SCHEMA_VERSION`): the legacy `messages` table holds
 *     `session_id, idx, role, content, timestamp, tool_calls_json,
 *      tokens_in, tokens_out`.
 *   - Schema v2 (`SCHEMA_VERSION_DB`): the uwf-shaped pair of tables —
 *     `sessions(id, model, started_at, input_tokens, output_tokens)` plus
 *     `messages(session_id, role, content, reasoning, tool_calls)` ordered
 *     by row `id`. This shape was observed in `@united-workforce/agent-hermes`
 *     and reappears in some hermes release lines.
 *
 * The reader opens the SQLite file in read-only mode using Node 22's built-in
 * `node:sqlite` module — zero native build deps. v2 is preferred when both
 * shapes are present; v1 is the legacy fallback (current adapter behavior).
 */

import { existsSync } from "node:fs";
import type { TokenUsage, ToolCall, Turn } from "@sumeru/core";
import { SCHEMA_VERSION, SCHEMA_VERSION_DB } from "./types.js";

type RowV1 = {
	idx: number;
	role: string;
	content: string;
	timestamp: string | number;
	tool_calls_json: string | null;
	tokens_in: number | null;
	tokens_out: number | null;
};

type RowV2 = {
	role: string;
	content: string | null;
	reasoning: string | null;
	tool_calls: string | null;
};

type SessionRowV2 = {
	id: string;
	model: string | null;
	started_at: number | null;
};

const REQUIRED_COLUMNS_V1 = [
	"session_id",
	"idx",
	"role",
	"content",
	"timestamp",
] as const;

const REQUIRED_COLUMNS_V2_MESSAGES = ["session_id", "role", "content"] as const;

const REQUIRED_COLUMNS_V2_SESSIONS = ["id"] as const;

export async function readTurnsFromDb(
	dbPath: string,
	nativeId: string,
): Promise<Turn[]> {
	if (!existsSync(dbPath)) {
		throw new Error(`hermes session DB not found at ${dbPath}`);
	}

	let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
	try {
		({ DatabaseSync } = await import("node:sqlite"));
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(
			`hermes session DB driver unavailable (node:sqlite): ${detail}`,
		);
	}

	let db: InstanceType<typeof DatabaseSync>;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`hermes session DB is unreadable: ${detail}`);
	}

	try {
		const tables = listTables(db);
		const messagesCols = tables.has("messages")
			? tableColumns(db, "messages")
			: new Set<string>();
		const sessionsCols = tables.has("sessions")
			? tableColumns(db, "sessions")
			: new Set<string>();

		// Prefer v2 (uwf shape) when both message+session tables match.
		if (
			tables.has("messages") &&
			tables.has("sessions") &&
			REQUIRED_COLUMNS_V2_MESSAGES.every((c) => messagesCols.has(c)) &&
			REQUIRED_COLUMNS_V2_SESSIONS.every((c) => sessionsCols.has(c))
		) {
			return readV2(db, nativeId);
		}

		// Fall back to v1 if messages table has the v1 shape.
		if (
			tables.has("messages") &&
			REQUIRED_COLUMNS_V1.every((c) => messagesCols.has(c))
		) {
			return readV1(db, nativeId);
		}

		// Neither shape matched — emit a schema mismatch error that names a
		// missing column and the version most recently attempted (v2 first).
		if (tables.has("messages") && tables.has("sessions")) {
			const missing =
				firstMissing(messagesCols, REQUIRED_COLUMNS_V2_MESSAGES) ??
				firstMissing(sessionsCols, REQUIRED_COLUMNS_V2_SESSIONS);
			throw new Error(
				`hermes session DB schema mismatch: missing column '${missing ?? "?"}' in table 'messages' (adapter attempted schema v${SCHEMA_VERSION_DB})`,
			);
		}
		const missing =
			firstMissing(messagesCols, REQUIRED_COLUMNS_V1) ?? "messages";
		throw new Error(
			`hermes session DB schema mismatch: missing column '${missing}' in table 'messages' (adapter pinned to schema v${SCHEMA_VERSION})`,
		);
	} finally {
		db.close();
	}
}

type DbHandle = InstanceType<typeof import("node:sqlite").DatabaseSync>;

function listTables(db: DbHandle): Set<string> {
	let rows: { name: unknown }[];
	try {
		rows = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table'")
			.all() as { name: unknown }[];
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`hermes session DB is unreadable: ${detail}`);
	}
	return new Set(rows.map((r) => String(r.name)));
}

function tableColumns(db: DbHandle, table: string): Set<string> {
	let columns: { name: unknown }[];
	try {
		// PRAGMA can't be parameterized; table name is a constant in callsites.
		columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
			name: unknown;
		}[];
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`hermes session DB is unreadable: ${detail}`);
	}
	return new Set(columns.map((c) => String(c.name)));
}

function firstMissing(
	present: Set<string>,
	required: readonly string[],
): string | null {
	for (const r of required) {
		if (!present.has(r)) return r;
	}
	return null;
}

function readV1(db: DbHandle, nativeId: string): Turn[] {
	const stmt = db.prepare(
		"SELECT idx, role, content, timestamp, tool_calls_json, tokens_in, tokens_out FROM messages WHERE session_id = ? ORDER BY idx ASC",
	);
	const rows = stmt.all(nativeId) as RowV1[];
	return rows.map(rowToTurnV1);
}

function readV2(db: DbHandle, nativeId: string): Turn[] {
	const session = db
		.prepare("SELECT id, model, started_at FROM sessions WHERE id = ?")
		.get(nativeId) as SessionRowV2 | null | undefined;
	if (session === null || session === undefined) return [];
	const rows = db
		.prepare(
			"SELECT role, content, reasoning, tool_calls FROM messages WHERE session_id = ? ORDER BY id ASC",
		)
		.all(nativeId) as RowV2[];
	const turns: Turn[] = [];
	let index = 0;
	for (const row of rows) {
		const role = row.role;
		if (
			role !== "user" &&
			role !== "assistant" &&
			role !== "system" &&
			role !== "tool"
		) {
			continue;
		}
		const turn: Turn = {
			index,
			role: normalizeRole(role),
			content: row.content ?? "",
			timestamp: deriveTimestamp(session.started_at),
			toolCalls: parseToolCallsUwfShape(row.tool_calls ?? null),
			tokens: null,
			hash: null,
		};
		turns.push(turn);
		index += 1;
	}
	return turns;
}

function rowToTurnV1(row: RowV1): Turn {
	const role = normalizeRole(row.role);
	const toolCalls = parseToolCalls(row.tool_calls_json ?? null);
	const tokens = parseTokens(row.tokens_in ?? null, row.tokens_out ?? null);
	const turn: Turn = {
		index: row.idx,
		role,
		content: row.content,
		timestamp: normalizeTimestamp(row.timestamp),
		toolCalls,
		tokens: tokens ?? null,
		hash: null,
	};
	return turn;
}

function normalizeRole(raw: string): "user" | "assistant" | "system" {
	if (raw === "user" || raw === "assistant" || raw === "system") return raw;
	// Hermes occasionally stores `tool` for tool_result rows; treat as assistant
	// for adapter purposes since the user-facing reply still flows from the model.
	return "assistant";
}

function normalizeTimestamp(raw: string | number): string {
	if (typeof raw === "number") {
		return new Date(raw).toISOString();
	}
	const trimmed = raw.trim();
	if (/Z$/.test(trimmed)) return trimmed;
	const t = Date.parse(trimmed);
	if (Number.isFinite(t)) return new Date(t).toISOString();
	// Fall back to current time; we never throw on per-row badness here.
	return new Date().toISOString();
}

function deriveTimestamp(startedAt: number | null): string {
	if (startedAt === null || startedAt === undefined) {
		return new Date(0).toISOString();
	}
	// uwf stores `started_at` as a unix-seconds integer.
	return new Date(startedAt * 1000).toISOString();
}

function parseToolCalls(raw: string | null): ToolCall[] | null {
	if (raw === null || raw === undefined || raw === "") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length === 0) return null;
	const calls: ToolCall[] = [];
	for (const item of parsed) {
		if (item === null || typeof item !== "object" || Array.isArray(item))
			continue;
		const obj = item as Record<string, unknown>;
		const tool = typeof obj.tool === "string" ? obj.tool : "";
		if (tool === "") continue;
		const input =
			obj.input !== null &&
			obj.input !== undefined &&
			typeof obj.input === "object" &&
			!Array.isArray(obj.input)
				? (obj.input as Record<string, unknown>)
				: {};
		const output = typeof obj.output === "string" ? obj.output : "";
		const durationMs =
			typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs)
				? obj.durationMs
				: 0;
		const exitCode =
			typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode)
				? obj.exitCode
				: null;
		calls.push({ tool, input, output, durationMs, exitCode });
	}
	return calls.length === 0 ? null : calls;
}

/** uwf-shape: `[{function:{name, arguments:"<json>"}}]` */
function parseToolCallsUwfShape(raw: string | null): ToolCall[] | null {
	if (raw === null || raw === "") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length === 0) return null;
	const calls: ToolCall[] = [];
	for (const entry of parsed) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry))
			continue;
		const fn = (entry as Record<string, unknown>).function;
		if (fn === null || typeof fn !== "object" || Array.isArray(fn)) continue;
		const fnObj = fn as Record<string, unknown>;
		const name = fnObj.name;
		const argsRaw = fnObj.arguments;
		if (typeof name !== "string" || name === "") continue;
		let input: Record<string, unknown> = {};
		if (typeof argsRaw === "string" && argsRaw.length > 0) {
			try {
				const a = JSON.parse(argsRaw) as unknown;
				if (a !== null && typeof a === "object" && !Array.isArray(a)) {
					input = a as Record<string, unknown>;
				}
			} catch {
				// keep input empty on parse failure
			}
		} else if (
			argsRaw !== null &&
			typeof argsRaw === "object" &&
			!Array.isArray(argsRaw)
		) {
			input = argsRaw as Record<string, unknown>;
		}
		calls.push({
			tool: name,
			input,
			output: "",
			durationMs: 0,
			exitCode: null,
		});
	}
	return calls.length === 0 ? null : calls;
}

function parseTokens(
	tokensIn: number | null,
	tokensOut: number | null,
): TokenUsage | undefined {
	if (
		(tokensIn === null || tokensIn === undefined) &&
		(tokensOut === null || tokensOut === undefined)
	) {
		return undefined;
	}
	return {
		input: typeof tokensIn === "number" ? tokensIn : 0,
		output: typeof tokensOut === "number" ? tokensOut : 0,
	};
}
