/**
 * Stream-json parser for Claude Code's
 * `claude -p ... --output-format stream-json --verbose` NDJSON output.
 */

import type { TurnValue, WireToolCall } from "@sumeru/adapter-core";
import type {
	ClaudeCodeParsedResult,
	ClaudeCodeResultSubtype,
	StreamParseEvent,
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
	turns: TurnValue[];
	pendingToolCalls: Map<string, WireToolCall>;
	resultLine: Record<string, unknown> | null;
	model: string;
	sessionId: string;
	turnIndex: number;
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

function extractToolCalls(content: unknown[]): Array<WireToolCall> {
	const calls: Array<WireToolCall> = [];
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
			id: typeof item.id === "string" ? item.id : `call_${calls.length}`,
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

	const turn: TurnValue = {
		index: state.turnIndex++,
		role: "assistant",
		content: textContent,
		timestamp: state.now,
		toolCalls: toolCalls.length > 0 ? toolCalls : null,
		tokens: null,
		durationMs: null,
	};
	state.turns.push(turn);

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

	const { toolUseId, text } = extractToolResultText(content);
	if (toolUseId !== null) {
		const target = state.pendingToolCalls.get(toolUseId);
		if (target !== undefined) {
			target.output = text;
			state.pendingToolCalls.delete(toolUseId);
			// Emit a progressive ToolTurnValue so the host records the tool
			// result as an independent turn (#182). The backfill above still
			// patches the assistant turn's WireToolCall.output for legacy
			// consumers that read turns from a single frame.
			state.turns.push({
				index: state.turnIndex++,
				role: "tool",
				name: target.tool,
				callId: target.id,
				result: text,
				durationMs: target.durationMs,
				timestamp: state.now,
			});
		}
		return;
	}

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
		durationMs: null,
	});
}

function extractPlainStringContent(content: unknown): string {
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

function extractLastAssistantContent(turns: TurnValue[]): string {
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
	return "incomplete";
}

function assembleResult(state: ParseState): ClaudeCodeParsedResult | null {
	if (state.resultLine === null) {
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

/** Parse full captured stream-json stdout into turns + result summary. */
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

/** Incremental async-generator parser for Claude Code NDJSON output. */
export async function* parseStreamJsonIncremental(
	lines: AsyncIterable<string>,
): AsyncGenerator<StreamParseEvent> {
	const state: ParseState = {
		turns: [],
		pendingToolCalls: new Map(),
		resultLine: null,
		model: "",
		sessionId: "",
		turnIndex: 0,
		now: new Date().toISOString(),
	};

	let metaYielded = false;

	for await (const line of lines) {
		const turnsBefore = state.turns.length;
		const hadResult = state.resultLine !== null;
		const hadSession = state.sessionId !== "";

		processLine(line, state);

		if (!metaYielded && !hadSession && state.sessionId !== "") {
			metaYielded = true;
			yield { type: "meta", sessionId: state.sessionId, model: state.model };
		}

		for (let i = turnsBefore; i < state.turns.length; i++) {
			const turn = state.turns[i];
			if (turn !== undefined) {
				yield { type: "turn", turn };
			}
		}

		if (!hadResult && state.resultLine !== null) {
			yield { type: "result", resultLine: state.resultLine };
		}
	}
}

/** Build a `DoneValue`-compatible summary from a parsed `result` line. */
export function doneValueFromResultLine(
	resultLine: Record<string, unknown> | null,
): {
	summary: string | null;
	tokenUsage: { input: number; output: number; cached: number } | null;
} {
	if (resultLine === null) {
		return { summary: null, tokenUsage: null };
	}
	const result = resultLine.result;
	const summary = typeof result === "string" ? result : null;
	const usage = isRecord(resultLine.usage) ? resultLine.usage : {};
	const input = safeNumber(usage.input_tokens);
	const output = safeNumber(usage.output_tokens);
	const cached = safeNumber(usage.cache_read_input_tokens);
	const tokenUsage =
		input === 0 && output === 0 && cached === 0
			? null
			: { input, output, cached };
	return { summary, tokenUsage };
}
