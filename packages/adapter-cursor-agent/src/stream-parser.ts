/**
 * Stream-json parser for cursor-agent's
 * `cursor-agent -p ... --output-format stream-json` NDJSON output.
 *
 * Each line is a JSON object with a `type` field:
 *   - `"system"` (subtype: `init`) — first line; carries `session_id`, `model`,
 *     `cwd`, `permissionMode`.
 *   - `"user"` — carries `message.content` array with text segments.
 *   - `"thinking"` (subtype: `delta` or `completed`) — reasoning text; discarded.
 *   - `"assistant"` — carries `message.content` array.
 *   - `"tool_call"` (subtype: `started`) — carries `call_id`,
 *     `tool_call.{editToolCall|shellToolCall}.args`.
 *   - `"tool_call"` (subtype: `completed`) — carries `call_id`,
 *     `tool_call.{...}.result`.
 *   - `"result"` (subtype: `success`) — carries `result`, `duration_ms`, `usage`.
 *
 * Unlike Claude Code (where tool_use is embedded in assistant message content
 * and tool_result is a user line), cursor-agent uses separate `tool_call`
 * events with explicit `started`/`completed` subtypes. The parser maps these
 * to Sumeru's `WireToolCall` model and emits a progressive `ToolTurnValue`
 * (#182) on each `completed` event.
 */

import type { TurnValue, WireToolCall } from "@sumeru/adapter-core";
import type {
	CursorAgentParsedResult,
	CursorAgentResultSubtype,
	StreamParseEvent,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(v: unknown, fallback = 0): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

type ParseState = {
	turns: TurnValue[];
	/** Map from `call_id` → reference to the `WireToolCall` waiting for its output. */
	pendingToolCalls: Map<string, WireToolCall>;
	resultLine: Record<string, unknown> | null;
	model: string;
	sessionId: string;
	turnIndex: number;
	/** ISO-8601 timestamp recorded once per parse so the result is deterministic. */
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

function processSystemLine(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	if (typeof parsed.session_id === "string")
		state.sessionId = parsed.session_id;
	if (typeof parsed.model === "string") state.model = parsed.model;
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
	if (textContent === "") return;

	state.turns.push({
		index: state.turnIndex++,
		role: "assistant",
		content: textContent,
		timestamp: state.now,
		toolCalls: null,
		tokens: null,
		durationMs: null,
	});
}

function processUserLine(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	if (!isRecord(parsed.message)) return;
	const content = Array.isArray(parsed.message.content)
		? (parsed.message.content as unknown[])
		: [];
	const userText = extractTextContent(content);
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

function getToolName(toolCallObj: Record<string, unknown>): string {
	if ("editToolCall" in toolCallObj) return "editToolCall";
	if ("shellToolCall" in toolCallObj) return "shellToolCall";
	// Fallback: find the first key that looks like a tool call
	for (const key of Object.keys(toolCallObj)) {
		if (key.endsWith("ToolCall")) return key;
	}
	return "unknownTool";
}

function getToolArgs(
	toolCallObj: Record<string, unknown>,
	toolName: string,
): Record<string, unknown> {
	const inner = toolCallObj[toolName];
	if (isRecord(inner) && isRecord(inner.args)) {
		return inner.args as Record<string, unknown>;
	}
	if (isRecord(inner)) {
		return inner as Record<string, unknown>;
	}
	return {};
}

function getToolResult(
	toolCallObj: Record<string, unknown>,
	toolName: string,
): { output: string; exitCode: number | null } {
	const inner = toolCallObj[toolName];
	if (!isRecord(inner)) return { output: "", exitCode: null };
	const result = inner.result;
	if (isRecord(result)) {
		const stdout = typeof result.stdout === "string" ? result.stdout : "";
		const content = typeof result.content === "string" ? result.content : "";
		const output = stdout || content || JSON.stringify(result);
		const exitCode =
			toolName === "shellToolCall" && typeof result.exitCode === "number"
				? result.exitCode
				: null;
		return { output, exitCode };
	}
	if (typeof result === "string") return { output: result, exitCode: null };
	return { output: JSON.stringify(result ?? null), exitCode: null };
}

function processToolCallStarted(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const callId = typeof parsed.call_id === "string" ? parsed.call_id : null;
	if (callId === null) return;

	const toolCallObj = parsed.tool_call;
	if (!isRecord(toolCallObj)) return;

	const toolName = getToolName(toolCallObj);
	const input = getToolArgs(toolCallObj, toolName);

	const call: WireToolCall = {
		id: callId,
		tool: toolName,
		input,
		output: null,
		durationMs: null,
		exitCode: null,
	};

	// Associate with the most recent assistant turn.
	const lastAssistantIdx = findLastAssistantTurnIndex(state.turns);
	if (lastAssistantIdx >= 0) {
		const turn = state.turns[lastAssistantIdx];
		if (turn !== undefined && turn.role !== "tool") {
			if (turn.toolCalls === null) {
				turn.toolCalls = [call];
			} else {
				turn.toolCalls.push(call);
			}
		}
	} else {
		// No assistant turn yet — create one with empty content to hold the tool call.
		state.turns.push({
			index: state.turnIndex++,
			role: "assistant",
			content: "",
			timestamp: state.now,
			toolCalls: [call],
			tokens: null,
			durationMs: null,
		});
	}

	state.pendingToolCalls.set(callId, call);
}

function processToolCallCompleted(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const callId = typeof parsed.call_id === "string" ? parsed.call_id : null;
	if (callId === null) return;

	const target = state.pendingToolCalls.get(callId);
	if (target === undefined) return; // unmatched completed — silently dropped

	const toolCallObj = parsed.tool_call;
	if (!isRecord(toolCallObj)) return;

	const toolName = target.tool;
	const { output, exitCode } = getToolResult(toolCallObj, toolName);
	target.output = output;
	target.exitCode = exitCode;
	state.pendingToolCalls.delete(callId);

	// Emit a progressive ToolTurnValue so the host records the tool result as
	// an independent turn (#182). The backfill above still patches the
	// assistant turn's WireToolCall.output for legacy consumers that read
	// turns from a single frame.
	state.turns.push({
		index: state.turnIndex++,
		role: "tool",
		name: toolName,
		callId: target.id,
		result: output,
		durationMs: target.durationMs,
		timestamp: state.now,
	});
}

function processToolCall(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const subtype = parsed.subtype;
	if (subtype === "started") {
		processToolCallStarted(parsed, state);
	} else if (subtype === "completed") {
		processToolCallCompleted(parsed, state);
	}
}

function findLastAssistantTurnIndex(turns: TurnValue[]): number {
	for (let i = turns.length - 1; i >= 0; i--) {
		if (turns[i]?.role === "assistant") return i;
	}
	return -1;
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
	else if (type === "tool_call") processToolCall(parsed, state);
	else if (type === "result") state.resultLine = parsed;
	// "thinking" lines are completely discarded — NOT emitted as Turns.
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

function coerceSubtype(raw: unknown): CursorAgentResultSubtype {
	if (raw === "success") return "success";
	return "incomplete";
}

function assembleResult(state: ParseState): CursorAgentParsedResult | null {
	if (state.resultLine === null) {
		// Incomplete path — at minimum we need a session id.
		if (state.sessionId === "") return null;
		return {
			type: "result",
			subtype: "incomplete",
			result: extractLastAssistantContent(state.turns),
			sessionId: state.sessionId,
			numTurns: state.turns.length,
			durationMs: 0,
			model: state.model,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			turns: state.turns,
		};
	}

	const result = state.resultLine.result;
	const usage = isRecord(state.resultLine.usage) ? state.resultLine.usage : {};
	const sessionIdFromResult =
		typeof state.resultLine.session_id === "string"
			? state.resultLine.session_id
			: state.sessionId;

	return {
		type:
			typeof state.resultLine.type === "string"
				? state.resultLine.type
				: "result",
		subtype: coerceSubtype(state.resultLine.subtype),
		result:
			typeof result === "string"
				? result
				: extractLastAssistantContent(state.turns),
		sessionId: sessionIdFromResult || state.sessionId,
		numTurns: state.turns.length,
		durationMs: safeNumber(state.resultLine.duration_ms),
		model: state.model,
		usage: {
			inputTokens: safeNumber(usage.inputTokens),
			outputTokens: safeNumber(usage.outputTokens),
			cacheReadTokens: safeNumber(usage.cacheReadTokens),
			cacheWriteTokens: safeNumber(usage.cacheWriteTokens),
		},
		turns: state.turns,
	};
}

/**
 * Parse cursor-agent stream-json (NDJSON) output into an ordered TurnValue[]
 * plus a result summary.
 *
 * Behavior:
 *   - Pure: same input → same output (modulo the per-call `now()` timestamp).
 *   - Tolerant: malformed lines and lines without a recognized `type` are
 *     silently skipped.
 *   - Returns `null` when neither a `system` line (with session_id) NOR a
 *     `result` line was parsed — the adapter caller maps this to a hard error.
 *
 * @param stdout Raw NDJSON text (the full captured stdout of `cursor-agent -p`).
 */
export function parseStreamJson(
	stdout: string,
): CursorAgentParsedResult | null {
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

/** Incremental async-generator parser for cursor-agent NDJSON output. */
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
	const input = safeNumber(usage.inputTokens);
	const output = safeNumber(usage.outputTokens);
	const cached = safeNumber(usage.cacheReadTokens);
	const tokenUsage =
		input === 0 && output === 0 && cached === 0
			? null
			: { input, output, cached };
	return { summary, tokenUsage };
}
