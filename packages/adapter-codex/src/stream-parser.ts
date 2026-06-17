/**
 * JSONL parser for Codex CLI's `codex exec --json` output.
 *
 * Codex emits JSONL to stdout. Each line is a JSON object with a `type` field.
 * Based on Codex CLI documentation and expected behavior:
 *
 *   - `"session.start"` — first line; carries `session_id` and initial config.
 *   - `"message"` — user or assistant messages with content.
 *   - `"function_call"` / `"tool_call"` — tool invocations.
 *   - `"function_call_output"` / `"tool_call_output"` — tool results.
 *   - `"session.end"` / `"done"` — final event with summary/usage.
 *
 * NOTE: This parser is based on expected Codex JSONL structure. The exact
 * schema depends on the spike to capture real output. The parser is designed
 * to be tolerant and handle variations.
 *
 * See `specs/adapter-codex-spike-jsonl-capture.md` for spike requirements.
 */

import type { ToolCall, Turn } from "@sumeru/core";
import type { CodexParsedResult, CodexResultSubtype } from "./types.js";

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
	/** Map from tool call id → reference to the ToolCall waiting for its output. */
	pendingToolCalls: Map<string, ToolCall>;
	resultLine: Record<string, unknown> | null;
	model: string;
	sessionId: string;
	turnIndex: number;
	/** ISO-8601 timestamp recorded once per parse. */
	now: string;
};

function extractTextContent(message: Record<string, unknown>): string {
	// Codex may use different content formats
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const item of content) {
			if (
				isRecord(item) &&
				item.type === "text" &&
				typeof item.text === "string"
			) {
				texts.push(item.text);
			} else if (typeof item === "string") {
				texts.push(item);
			}
		}
		return texts.join("\n");
	}
	return "";
}

function extractToolCalls(message: Record<string, unknown>): ToolCall[] {
	const calls: ToolCall[] = [];

	// Check for tool_calls array (OpenAI format)
	const toolCalls = message.tool_calls;
	if (Array.isArray(toolCalls)) {
		for (const tc of toolCalls) {
			if (!isRecord(tc)) continue;
			const fn = isRecord(tc.function) ? tc.function : tc;
			const name = safeString(fn.name ?? tc.name);
			if (name === "") continue;

			let input: Record<string, unknown>;
			const args = fn.arguments ?? fn.input ?? tc.arguments ?? tc.input;
			if (typeof args === "string") {
				try {
					const parsed = JSON.parse(args);
					input = isRecord(parsed) ? parsed : { raw: args };
				} catch {
					input = { raw: args };
				}
			} else if (isRecord(args)) {
				input = args;
			} else {
				input = {};
			}

			calls.push({
				tool: name,
				input,
				output: null,
				durationMs: null,
				exitCode: null,
			});
		}
	}

	// Also check for function_call (older format)
	const functionCall = message.function_call;
	if (isRecord(functionCall) && typeof functionCall.name === "string") {
		let input: Record<string, unknown>;
		const args = functionCall.arguments;
		if (typeof args === "string") {
			try {
				const parsed = JSON.parse(args);
				input = isRecord(parsed) ? parsed : { raw: args };
			} catch {
				input = { raw: args };
			}
		} else if (isRecord(args)) {
			input = args;
		} else {
			input = {};
		}

		calls.push({
			tool: functionCall.name,
			input,
			output: null,
			durationMs: null,
			exitCode: null,
		});
	}

	return calls;
}

function extractToolCallIds(message: Record<string, unknown>): string[] {
	const ids: string[] = [];
	const toolCalls = message.tool_calls;
	if (Array.isArray(toolCalls)) {
		for (const tc of toolCalls) {
			if (isRecord(tc) && typeof tc.id === "string") {
				ids.push(tc.id);
			}
		}
	}
	return ids;
}

function processSessionStart(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	// Look for session_id in various places Codex might put it
	const sessionId =
		safeString(parsed.session_id) ||
		safeString(parsed.sessionId) ||
		safeString(parsed.id);
	if (sessionId !== "") {
		state.sessionId = sessionId;
	}

	const model = safeString(parsed.model);
	if (model !== "") {
		state.model = model;
	}
}

function processMessage(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const role = safeString(parsed.role);
	const message = isRecord(parsed.message)
		? parsed.message
		: isRecord(parsed.content)
			? { content: parsed.content }
			: parsed;

	// Determine the actual role
	let turnRole: "user" | "assistant" | "system";
	if (role === "user" || parsed.type === "user") {
		turnRole = "user";
	} else if (role === "assistant" || parsed.type === "assistant") {
		turnRole = "assistant";
	} else if (role === "system" || parsed.type === "system") {
		turnRole = "system";
	} else {
		// Default to assistant for messages without explicit role
		turnRole = "assistant";
	}

	const textContent = extractTextContent(message);
	const toolCalls = turnRole === "assistant" ? extractToolCalls(message) : [];

	// Skip empty turns
	if (textContent === "" && toolCalls.length === 0) {
		return;
	}

	const turn: Turn = {
		index: state.turnIndex++,
		role: turnRole,
		content: textContent,
		timestamp: state.now,
		toolCalls: toolCalls.length > 0 ? toolCalls : null,
		tokens: null,
		hash: null,
	};
	state.turns.push(turn);

	// Register tool call IDs for later matching with outputs
	if (turnRole === "assistant") {
		const ids = extractToolCallIds(message);
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			const call = toolCalls[i];
			if (id !== undefined && call !== undefined) {
				state.pendingToolCalls.set(id, call);
			}
		}
	}
}

function processToolOutput(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const toolCallId = safeString(
		parsed.tool_call_id ?? parsed.function_call_id ?? parsed.id,
	);
	const output = safeString(parsed.output ?? parsed.content ?? parsed.result);

	if (toolCallId !== "") {
		const target = state.pendingToolCalls.get(toolCallId);
		if (target !== undefined) {
			target.output = output;
			state.pendingToolCalls.delete(toolCallId);
		}
	}
}

function processResult(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	state.resultLine = parsed;

	// Extract session_id from result if not already set
	const sessionId =
		safeString(parsed.session_id) || safeString(parsed.sessionId);
	if (sessionId !== "" && state.sessionId === "") {
		state.sessionId = sessionId;
	}

	// Extract model from result if not already set
	const model = safeString(parsed.model);
	if (model !== "" && state.model === "") {
		state.model = model;
	}
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

	const type = safeString(parsed.type);

	// Session start events
	if (
		type === "session.start" ||
		type === "session_start" ||
		type === "init" ||
		type === "system"
	) {
		processSessionStart(parsed, state);
		return;
	}

	// Message events
	if (type === "message" || type === "user" || type === "assistant") {
		processMessage(parsed, state);
		return;
	}

	// Tool call output events
	if (
		type === "function_call_output" ||
		type === "tool_call_output" ||
		type === "tool_output" ||
		type === "tool_result"
	) {
		processToolOutput(parsed, state);
		return;
	}

	// Result/done events
	if (
		type === "session.end" ||
		type === "session_end" ||
		type === "done" ||
		type === "result" ||
		type === "complete"
	) {
		processResult(parsed, state);
		return;
	}

	// If it has a role field, treat as a message
	if (parsed.role !== undefined) {
		processMessage(parsed, state);
	}
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

function coerceSubtype(raw: unknown): CodexResultSubtype {
	if (raw === "success" || raw === "error" || raw === "incomplete") {
		return raw;
	}
	// Map Codex-specific subtypes
	if (raw === "completed" || raw === "done" || raw === "end_turn") {
		return "success";
	}
	if (
		raw === "error_max_turns" ||
		raw === "error_budget" ||
		(typeof raw === "string" && raw.startsWith("error"))
	) {
		return "error";
	}
	return "incomplete";
}

function assembleResult(state: ParseState): CodexParsedResult | null {
	// If we have no result line but have a session ID, return an incomplete result
	if (state.resultLine === null) {
		if (state.sessionId === "") return null;
		return {
			type: "result",
			subtype: "incomplete",
			result: extractLastAssistantContent(state.turns),
			sessionId: state.sessionId,
			numTurns: state.turns.length,
			durationMs: 0,
			model: state.model,
			stopReason: "incomplete_no_result_line",
			usage: {
				inputTokens: 0,
				outputTokens: 0,
			},
			turns: state.turns,
		};
	}

	const subtype = state.resultLine.subtype ?? state.resultLine.status;
	const sessionIdFromResult =
		safeString(state.resultLine.session_id) ||
		safeString(state.resultLine.sessionId) ||
		state.sessionId;

	// Extract usage - check various field names Codex might use
	const usage = isRecord(state.resultLine.usage)
		? state.resultLine.usage
		: state.resultLine;

	const inputTokens = safeNumber(
		usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens,
	);
	const outputTokens = safeNumber(
		usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens,
	);

	return {
		type: safeString(state.resultLine.type, "result"),
		subtype: coerceSubtype(subtype),
		result:
			typeof state.resultLine.result === "string"
				? state.resultLine.result
				: extractLastAssistantContent(state.turns),
		sessionId: sessionIdFromResult,
		numTurns: state.turns.length,
		durationMs: safeNumber(
			state.resultLine.duration_ms ?? state.resultLine.durationMs,
		),
		model: state.model,
		stopReason: safeString(
			state.resultLine.stop_reason ??
				state.resultLine.stopReason ??
				state.resultLine.finish_reason,
		),
		usage: {
			inputTokens,
			outputTokens,
		},
		turns: state.turns,
	};
}

/**
 * Parse Codex JSONL output into an ordered Turn[] plus a result summary.
 *
 * Behavior:
 *   - Pure: same input → same output (modulo the per-call timestamp).
 *   - Tolerant: malformed lines and lines without a recognized type are
 *     silently skipped.
 *   - Returns `null` when neither a session start/ID NOR a result line was
 *     parsed — the adapter caller maps this to a hard error.
 *
 * @param stdout Raw JSONL text (the full captured stdout of `codex exec`).
 */
export function parseCodexJson(stdout: string): CodexParsedResult | null {
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
