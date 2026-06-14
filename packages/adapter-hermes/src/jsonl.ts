/**
 * Per-session JSONL turn reader for hermes v0.15.1+.
 *
 * Reads `~/.hermes/sessions/<nativeId>.jsonl`. Each line is one JSON object.
 * The leading `role: "session_meta"` row is metadata, not a turn. Subsequent
 * rows are `user`, `assistant`, or `tool`. The adapter normalizes `tool` rows
 * to `assistant` for the `@sumeru/core` `Turn` shape (matches `db.ts`).
 *
 * Per spec:
 *   - returns `null` when the file does not exist (caller falls back to DB)
 *   - returns `null` when the file exists but every line fails to parse
 *   - returns `[]` (a Turn array, possibly empty) when the file exists and
 *     parsed cleanly — even if zero turn rows were extracted (an empty JSONL
 *     means "session created but no turns yet")
 *   - skips single malformed lines silently; one bad line MUST NOT kill the
 *     whole read
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolCall, Turn } from "@sumeru/core";

export type JsonlReader = (
	sessionsDir: string,
	nativeId: string,
) => Promise<Turn[] | null>;

type TurnRow = {
	role: string;
	content: string | null | undefined;
	timestamp: string | number | null | undefined;
	tool_calls: unknown;
};

export async function readTurnsFromJsonl(
	sessionsDir: string,
	nativeId: string,
): Promise<Turn[] | null> {
	const path = join(sessionsDir, `${nativeId}.jsonl`);
	let text: string;
	try {
		const s = await stat(path);
		if (!s.isFile()) return null;
		text = await readFile(path, "utf-8");
	} catch {
		return null;
	}

	const lines = text.split(/\r?\n/);
	const rows: TurnRow[] = [];
	let parsedAnyLine = false;
	let hasNonBlankLine = false;
	for (const line of lines) {
		if (line.length === 0) continue;
		hasNonBlankLine = true;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		parsedAnyLine = true;
		if (!isRecord(parsed)) continue;
		const role = parsed.role;
		if (typeof role !== "string") continue;
		if (role === "session_meta") continue;
		if (
			role !== "user" &&
			role !== "assistant" &&
			role !== "system" &&
			role !== "tool"
		) {
			continue;
		}
		rows.push({
			role,
			content:
				typeof parsed.content === "string"
					? parsed.content
					: parsed.content === null
						? null
						: undefined,
			timestamp:
				typeof parsed.timestamp === "string" ||
				typeof parsed.timestamp === "number"
					? parsed.timestamp
					: null,
			tool_calls: parsed.tool_calls,
		});
	}

	// File exists but had non-blank lines that all failed JSON.parse → caller
	// should fall through to DB. Empty/whitespace-only file → return [].
	if (hasNonBlankLine && !parsedAnyLine) return null;

	const turns: Turn[] = [];
	let index = 0;
	for (const row of rows) {
		const role = normalizeRole(row.role);
		const content = typeof row.content === "string" ? row.content : "";
		const timestamp = normalizeTimestamp(row.timestamp);
		const toolCalls = parseToolCalls(row.tool_calls);
		const turn: Turn = {
			index,
			role,
			content,
			timestamp,
			toolCalls,
			tokens: null,
			hash: null,
		};
		turns.push(turn);
		index += 1;
	}
	return turns;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRole(raw: string): "user" | "assistant" | "system" {
	if (raw === "user" || raw === "assistant" || raw === "system") return raw;
	// `tool` rows: surface as assistant (matches db.ts normalizeRole)
	return "assistant";
}

function normalizeTimestamp(raw: string | number | null | undefined): string {
	if (typeof raw === "number") {
		return new Date(raw).toISOString();
	}
	if (typeof raw === "string" && raw.length > 0) {
		const trimmed = raw.trim();
		if (/Z$/.test(trimmed)) return trimmed;
		const t = Date.parse(`${trimmed}Z`);
		if (Number.isFinite(t)) return new Date(t).toISOString();
		const t2 = Date.parse(trimmed);
		if (Number.isFinite(t2)) return new Date(t2).toISOString();
	}
	return new Date(0).toISOString();
}

/**
 * Parse a JSONL `tool_calls` array (uwf shape: `[{function: {name, arguments}}]`).
 * `arguments` is a JSON string; we attempt to parse it into an object for
 * `ToolCall.input`. Returns `null` when no usable entries are present.
 */
function parseToolCalls(raw: unknown): ToolCall[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const calls: ToolCall[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const fn = entry.function;
		if (!isRecord(fn)) continue;
		const name = fn.name;
		const argsRaw = fn.arguments;
		if (typeof name !== "string" || name === "") continue;
		let input: Record<string, unknown> = {};
		if (typeof argsRaw === "string" && argsRaw.length > 0) {
			try {
				const parsed = JSON.parse(argsRaw) as unknown;
				if (isRecord(parsed)) input = parsed;
			} catch {
				// keep input empty on parse failure
			}
		} else if (isRecord(argsRaw)) {
			input = argsRaw;
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
