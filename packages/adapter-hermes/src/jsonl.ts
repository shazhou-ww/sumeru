import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolCall, TurnValue } from "@sumeru/core";
import type { JsonlReader } from "./types.js";

export const readTurnsFromJsonl: JsonlReader = async (
	sessionsDir,
	nativeId,
) => {
	const path = join(sessionsDir, `${nativeId}.jsonl`);
	let text: string;
	try {
		const fileStat = await stat(path);
		if (!fileStat.isFile()) return null;
		text = await readFile(path, "utf-8");
	} catch {
		return null;
	}

	const lines = text.split(/\r?\n/);
	const rows: Array<{
		role: string;
		content: string;
		timestamp: string;
		toolCalls: Array<ToolCall> | null;
	}> = [];
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
		if (role !== "user" && role !== "assistant" && role !== "system") {
			continue;
		}
		rows.push({
			role,
			content: typeof parsed.content === "string" ? parsed.content : "",
			timestamp: normalizeTimestamp(parsed.timestamp),
			toolCalls: parseToolCalls(parsed.tool_calls),
		});
	}

	if (hasNonBlankLine && !parsedAnyLine) return null;

	return rows.map((row, index) => ({
		index,
		role: normalizeRole(row.role),
		content: row.content,
		timestamp: row.timestamp,
		toolCalls: row.toolCalls,
		tokens: null,
	}));
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRole(raw: string): TurnValue["role"] {
	if (raw === "user" || raw === "assistant" || raw === "system") return raw;
	return "assistant";
}

function normalizeTimestamp(raw: unknown): string {
	if (typeof raw === "number") {
		return new Date(raw).toISOString();
	}
	if (typeof raw === "string" && raw.length > 0) {
		const trimmed = raw.trim();
		if (/Z$/.test(trimmed)) return trimmed;
		const parsed = Date.parse(`${trimmed}Z`);
		if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
		const parsedLocal = Date.parse(trimmed);
		if (Number.isFinite(parsedLocal))
			return new Date(parsedLocal).toISOString();
	}
	return new Date(0).toISOString();
}

function parseToolCalls(raw: unknown): Array<ToolCall> | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const calls: Array<ToolCall> = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const fn = entry.function;
		if (!isRecord(fn)) continue;
		const name = fn.name;
		const argsRaw = fn.arguments;
		if (typeof name !== "string" || name.length === 0) continue;
		let input: Record<string, unknown> = {};
		if (typeof argsRaw === "string" && argsRaw.length > 0) {
			try {
				const parsed = JSON.parse(argsRaw) as unknown;
				if (isRecord(parsed)) input = parsed;
			} catch {
				// keep empty input
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
