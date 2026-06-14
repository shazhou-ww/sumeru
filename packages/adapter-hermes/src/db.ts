/**
 * Read-only Hermes session-DB turn reader.
 *
 * Pinned to schema v1 (`SCHEMA_VERSION` in `./types.ts`). Opens the SQLite
 * file in read-only mode using Node 22's built-in `node:sqlite` module so
 * the package has zero native build deps.
 *
 * Schema (best-effort, observed from current Hermes versions; the adapter
 * tolerates missing optional columns):
 *   messages(session_id TEXT, idx INTEGER, role TEXT, content TEXT,
 *            timestamp TEXT, tool_calls_json TEXT,
 *            tokens_in INTEGER, tokens_out INTEGER)
 *
 * Required columns (failure mode = schema mismatch error): `session_id`,
 * `idx`, `role`, `content`, `timestamp`. Optional: `tool_calls_json`,
 * `tokens_in`, `tokens_out`.
 */

import { existsSync } from "node:fs";
import type { TokenUsage, ToolCall, Turn } from "@sumeru/core";
import { SCHEMA_VERSION } from "./types.js";

type Row = {
	idx: number;
	role: string;
	content: string;
	timestamp: string | number;
	tool_calls_json: string | null;
	tokens_in: number | null;
	tokens_out: number | null;
};

const REQUIRED_COLUMNS = [
	"session_id",
	"idx",
	"role",
	"content",
	"timestamp",
] as const;

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
		assertSchema(db);
		const stmt = db.prepare(
			"SELECT idx, role, content, timestamp, tool_calls_json, tokens_in, tokens_out FROM messages WHERE session_id = ? ORDER BY idx ASC",
		);
		const rows = stmt.all(nativeId) as Row[];
		return rows.map(rowToTurn);
	} finally {
		db.close();
	}
}

function assertSchema(db: {
	prepare: (sql: string) => { all: () => unknown[] };
}): void {
	let columns: { name: unknown }[];
	try {
		columns = db.prepare("PRAGMA table_info(messages)").all() as {
			name: unknown;
		}[];
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`hermes session DB is unreadable: ${detail}`);
	}
	const present = new Set(columns.map((c) => String(c.name)));
	for (const required of REQUIRED_COLUMNS) {
		if (!present.has(required)) {
			throw new Error(
				`hermes session DB schema mismatch: missing column '${required}' in table 'messages' (adapter pinned to schema v${SCHEMA_VERSION})`,
			);
		}
	}
}

function rowToTurn(row: Row): Turn {
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
