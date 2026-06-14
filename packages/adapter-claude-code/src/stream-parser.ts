/**
 * Stream-json parser for Claude Code's
 * `claude -p ... --output-format stream-json --verbose` NDJSON output.
 *
 * Each line is a JSON object with a `type` field:
 *   - `"system"`   — first line of every run; carries `session_id` and `model`.
 *   - `"assistant"` — model-emitted message; `content` is an array with
 *                     `{type:"text", text}` and `{type:"tool_use", id, name, input}`
 *                     segments.
 *   - `"user"`     — user-side input. Two flavors:
 *                       1. The user prompt at the start of a fresh `-p` run
 *                          (`content` is a `text` segment).
 *                       2. A tool-result reply (`content` is a `tool_result`
 *                          segment with `tool_use_id`).
 *   - `"result"`   — last line; carries the run's outcome (subtype, usage,
 *                     stop_reason, etc.).
 *
 * Ported from `~/repos/united-workforce/packages/agent-claude-code/src/session-detail.ts`
 * with these adaptations:
 *   - Drops every `@united-workforce/*` and `@ocas/core` import (Sumeru does
 *     NOT persist parser output — the server layer handles ocas writes).
 *   - Renames the public function to `parseStreamJson` (matches Sumeru naming).
 *   - Uses Sumeru's `Turn`/`ToolCall` from `@sumeru/core` (not a CC-specific shape).
 *   - Folds `tool_result` user lines into the matching assistant turn's
 *     `ToolCall.output` instead of emitting a separate `tool_result` turn
 *     (Sumeru's `Turn.role` does not include `tool_result`).
 *   - Emits the user's initial `-p` prompt as a `role: "user"` Turn at index 0
 *     so callers always see the user message in the history.
 */

import type { ToolCall, Turn } from "@sumeru/core";
import type {
	ClaudeCodeParsedResult,
	ClaudeCodeResultSubtype,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(v: unknown, fallback = 0): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeString(v: unknown, fallback = ""): string {
	return typeof v === "string" ? v : fallback;
}

type ParseState = {
	turns: Turn[];
	/** Map from `tool_use.id` → reference to the `ToolCall` waiting for its output. */
	pendingToolCalls: Map<string, ToolCall>;
	resultLine: Record<string, unknown> | null;
	model: string;
	sessionId: string;
	turnIndex: number;
	/** ISO-8601 timestamp recorded once per parse so the result is deterministic
	 *  for a single invocation while still varying between calls. */
	now: string;
};

function extractTextContent(content: unknown[]): string {
	const texts: string[] = [];
	for (const item of content) {
		if (
			isRecord(item) &&
			item.type === "text" &&
			typeof item.text === "string"
		) {
			texts.push(item.text);
		}
	}
	return texts.join("\n");
}

function extractToolCalls(content: unknown[]): ToolCall[] {
	const calls: ToolCall[] = [];
	for (const item of content) {
		if (
			!isRecord(item) ||
			item.type !== "tool_use" ||
			typeof item.name !== "string"
		) {
			continue;
		}
		const input = isRecord(item.input)
			? (item.input as Record<string, unknown>)
			: {
					raw:
						typeof item.input === "string"
							? item.input
							: JSON.stringify(item.input ?? null),
				};
		calls.push({
			tool: item.name,
			input,
			output: null,
			durationMs: null,
			exitCode: null,
		});
	}
	return calls;
}

function extractToolUseIds(content: unknown[]): string[] {
	const ids: string[] = [];
	for (const item of content) {
		if (
			isRecord(item) &&
			item.type === "tool_use" &&
			typeof item.id === "string"
		) {
			ids.push(item.id);
		}
	}
	return ids;
}

function extractToolResultText(content: unknown[]): {
	toolUseId: string | null;
	text: string;
} {
	let toolUseId: string | null = null;
	const segments: string[] = [];
	for (const item of content) {
		if (!isRecord(item)) continue;
		if (item.type === "tool_result") {
			if (typeof item.tool_use_id === "string" && toolUseId === null) {
				toolUseId = item.tool_use_id;
			}
			if (typeof item.content === "string") {
				segments.push(item.content);
			} else if (Array.isArray(item.content)) {
				for (const seg of item.content) {
					if (
						isRecord(seg) &&
						seg.type === "text" &&
						typeof seg.text === "string"
					) {
						segments.push(seg.text);
					}
				}
			}
		}
	}
	return { toolUseId, text: segments.join("\n") };
}

function processSystemLine(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	if (typeof parsed.model === "string") state.model = parsed.model;
	if (typeof parsed.session_id === "string")
		state.sessionId = parsed.session_id;
}

function processAssistantLine(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	if (!isRecord(parsed.message)) return;
	const content = Array.isArray(parsed.message.content)
		? (parsed.message.content as unknown[])
		: [];
	const textContent = extractTextContent(content);
	const toolCalls = extractToolCalls(content);
	if (textContent === "" && toolCalls.length === 0) return;

	const turn: Turn = {
		index: state.turnIndex++,
		role: "assistant",
		content: textContent,
		timestamp: state.now,
		toolCalls: toolCalls.length > 0 ? toolCalls : null,
		tokens: null,
		hash: null,
	};
	state.turns.push(turn);

	// Register every `tool_use.id` so a later `tool_result` user line can find
	// its target ToolCall and fill in the output.
	const ids = extractToolUseIds(content);
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i];
		const call = toolCalls[i];
		if (id !== undefined && call !== undefined) {
			state.pendingToolCalls.set(id, call);
		}
	}
}

function processUserLine(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	if (!isRecord(parsed.message)) return;
	const content = Array.isArray(parsed.message.content)
		? (parsed.message.content as unknown[])
		: [];

	// Try tool_result path first — these are paired with an earlier tool_use
	// and do NOT produce a separate Turn (Sumeru's Turn.role is user|assistant|system).
	const { toolUseId, text } = extractToolResultText(content);
	if (toolUseId !== null) {
		const target = state.pendingToolCalls.get(toolUseId);
		if (target !== undefined) {
			target.output = text;
			state.pendingToolCalls.delete(toolUseId);
		}
		// Drop unmatched tool_result silently — the parser is tolerant.
		return;
	}

	// Otherwise this is the user's initial prompt for a fresh `-p` run; emit it
	// as a role: "user" Turn so callers see the user message in history.
	const userText =
		extractTextContent(content) ||
		extractPlainStringContent(parsed.message.content);
	if (userText === "") return;
	state.turns.push({
		index: state.turnIndex++,
		role: "user",
		content: userText,
		timestamp: state.now,
		toolCalls: null,
		tokens: null,
		hash: null,
	});
}

function extractPlainStringContent(content: unknown): string {
	// Some CC versions stringify the user prompt directly into `content`.
	return typeof content === "string" ? content : "";
}

function processLine(line: string, state: ParseState): void {
	const trimmed = line.trim();
	if (trimmed === "") return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return;
	}
	if (!isRecord(parsed)) return;
	const type = parsed.type;
	if (type === "system") processSystemLine(parsed, state);
	else if (type === "assistant") processAssistantLine(parsed, state);
	else if (type === "user") processUserLine(parsed, state);
	else if (type === "result") state.resultLine = parsed;
}

function extractLastAssistantContent(turns: Turn[]): string {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (
			turn !== undefined &&
			turn.role === "assistant" &&
			turn.content !== ""
		) {
			return turn.content;
		}
	}
	return "";
}

function coerceSubtype(raw: unknown): ClaudeCodeResultSubtype {
	if (
		raw === "success" ||
		raw === "error_max_turns" ||
		raw === "error_budget" ||
		raw === "incomplete"
	) {
		return raw;
	}
	// Unknown subtype — bucket under "incomplete" so callers can still inspect
	// the rest of the parsed result.
	return "incomplete";
}

function assembleResult(state: ParseState): ClaudeCodeParsedResult | null {
	if (state.resultLine === null) {
		// Incomplete path — at minimum we need a session id.
		if (state.sessionId === "") return null;
		return {
			type: "result",
			subtype: "incomplete",
			result: extractLastAssistantContent(state.turns),
			sessionId: state.sessionId,
			numTurns: state.turns.length,
			totalCostUsd: 0,
			durationMs: 0,
			model: state.model,
			stopReason: "incomplete_no_result_line",
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
			},
			turns: state.turns,
		};
	}

	const result = state.resultLine.result;
	const subtype = state.resultLine.subtype;
	if (typeof subtype !== "string") return null;
	const sessionIdFromResult =
		typeof state.resultLine.session_id === "string"
			? state.resultLine.session_id
			: state.sessionId;
	const usage = isRecord(state.resultLine.usage) ? state.resultLine.usage : {};
	return {
		type: safeString(state.resultLine.type, "result"),
		subtype: coerceSubtype(subtype),
		result:
			typeof result === "string"
				? result
				: extractLastAssistantContent(state.turns),
		sessionId: sessionIdFromResult,
		// CC's result line `num_turns` reports only the final summary turn
		// (always 1), not cumulative session turns. Use the parsed turn count.
		numTurns: state.turns.length,
		totalCostUsd: safeNumber(state.resultLine.total_cost_usd),
		durationMs: safeNumber(state.resultLine.duration_ms),
		model: state.model,
		stopReason: safeString(state.resultLine.stop_reason),
		usage: {
			inputTokens: safeNumber(usage.input_tokens),
			outputTokens: safeNumber(usage.output_tokens),
			cacheReadInputTokens: safeNumber(usage.cache_read_input_tokens),
			cacheCreationInputTokens: safeNumber(usage.cache_creation_input_tokens),
		},
		turns: state.turns,
	};
}

/**
 * Parse Claude Code stream-json (NDJSON) output into an ordered Turn[] plus
 * a result summary.
 *
 * Behavior:
 *   - Pure: same input → same output (modulo the per-call `now()` timestamp).
 *   - Tolerant: malformed lines and lines without a recognized `type` are
 *     silently skipped.
 *   - Returns `null` when neither a `system` line (with session_id) NOR a
 *     `result` line was parsed — the adapter caller maps this to a hard error.
 *
 * @param stdout Raw NDJSON text (the full captured stdout of `claude -p`).
 */
export function parseStreamJson(stdout: string): ClaudeCodeParsedResult | null {
	const lines = stdout.split("\n");
	const state: ParseState = {
		turns: [],
		pendingToolCalls: new Map(),
		resultLine: null,
		model: "",
		sessionId: "",
		turnIndex: 0,
		now: new Date().toISOString(),
	};
	for (const line of lines) {
		processLine(line, state);
	}
	return assembleResult(state);
}
