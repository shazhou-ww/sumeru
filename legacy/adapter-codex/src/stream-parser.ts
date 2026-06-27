/**
 * JSONL parser for Codex CLI's `codex exec --json` output.
 *
 * Codex v0.141.0 emits JSONL to stdout. Each line is a JSON object with a `type` field.
 * The real schema has exactly 5 event types:
 *
 *   - `"thread.started"` — first JSON line; carries `thread_id` (UUID v7).
 *   - `"turn.started"` — marks beginning of a turn (no payload fields).
 *   - `"item.started"` — tool execution begins (item with status: "in_progress").
 *   - `"item.completed"` — message or tool result finalized.
 *   - `"turn.completed"` — end of turn; carries `usage` with token counts.
 *
 * Item types within `item.completed`:
 *   - `"agent_message"` — text response from the agent (`item.text`).
 *   - `"command_execution"` — tool call result (`item.command`, `item.aggregated_output`, `item.exit_code`).
 *
 * NOTE: The first line of stdout is often a non-JSON text line like
 * "Reading additional input from stdin..." — the parser silently skips it.
 */

import type { ToolCall, Turn } from "@sumeru/core";
import type {
	CodexParsedResult,
	CodexResultSubtype,
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
	turns: Turn[];
	resultLine: Record<string, unknown> | null;
	model: string;
	sessionId: string;
	turnIndex: number;
	/** ISO-8601 timestamp recorded once per parse. */
	now: string;
};

function processThreadStarted(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const threadId = safeString(parsed.thread_id);
	if (threadId !== "") {
		state.sessionId = threadId;
	}
}

function processItemCompleted(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	const item = parsed.item;
	if (!isRecord(item)) return;

	const itemType = safeString(item.type);

	if (itemType === "agent_message") {
		const text = safeString(item.text);
		const turn: Turn = {
			index: state.turnIndex++,
			role: "assistant",
			content: text,
			timestamp: state.now,
			toolCalls: null,
			tokens: null,
			hash: null,
		};
		state.turns.push(turn);
		return;
	}

	if (itemType === "command_execution") {
		// Only produce turns for completed commands (not in_progress from item.started)
		const status = safeString(item.status);
		if (status !== "completed") return;

		const command = safeString(item.command);
		const aggregatedOutput = safeString(item.aggregated_output);
		const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;

		const toolCall: ToolCall = {
			tool: "command_execution",
			input: { command },
			output: aggregatedOutput,
			durationMs: null,
			exitCode,
		};

		const turn: Turn = {
			index: state.turnIndex++,
			role: "assistant",
			content: "",
			timestamp: state.now,
			toolCalls: [toolCall],
			tokens: null,
			hash: null,
		};
		state.turns.push(turn);
	}
}

function processTurnCompleted(
	parsed: Record<string, unknown>,
	state: ParseState,
): void {
	state.resultLine = parsed;
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

	if (type === "thread.started") {
		processThreadStarted(parsed, state);
		return;
	}

	if (type === "item.completed") {
		processItemCompleted(parsed, state);
		return;
	}

	if (type === "turn.completed") {
		processTurnCompleted(parsed, state);
		return;
	}

	// turn.started and item.started are no-ops — silently ignored.
	// Unknown event types and non-JSON lines are silently skipped.
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

function assembleResult(state: ParseState): CodexParsedResult | null {
	// If we have no result line and no session ID, return null
	if (state.resultLine === null && state.sessionId === "") return null;

	// No turn.completed — incomplete result
	if (state.resultLine === null) {
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

	// Extract usage from turn.completed
	const usage = isRecord(state.resultLine.usage)
		? state.resultLine.usage
		: state.resultLine;

	const inputTokens = safeNumber(usage.input_tokens);
	const outputTokens = safeNumber(usage.output_tokens);

	const subtype: CodexResultSubtype = "success";

	return {
		type: "result",
		subtype,
		result: extractLastAssistantContent(state.turns),
		sessionId: state.sessionId,
		numTurns: state.turns.length,
		durationMs: 0,
		model: state.model,
		stopReason: "turn_completed",
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

/**
 * Incremental async-generator parser for Codex JSONL output.
 *
 * Yields `StreamParseEvent` as each line is consumed:
 *   - `{ type: "meta" }` after the `thread.started` event sets session id.
 *   - `{ type: "turn" }` for each new Turn added from `item.completed`.
 *   - `{ type: "result" }` when `turn.completed` is encountered.
 *
 * Non-JSON lines, `turn.started`, and `item.started` events are silently skipped.
 */
export async function* parseCodexJsonIncremental(
	lines: AsyncIterable<string>,
): AsyncGenerator<StreamParseEvent> {
	const state: ParseState = {
		turns: [],
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

		// Yield meta event once session info is available
		if (!metaYielded && !hadSession && state.sessionId !== "") {
			metaYielded = true;
			yield { type: "meta", sessionId: state.sessionId, model: state.model };
		}

		// Yield new turns
		for (let i = turnsBefore; i < state.turns.length; i++) {
			const turn = state.turns[i];
			if (turn !== undefined) {
				yield { type: "turn", turn };
			}
		}

		// Yield result event
		if (!hadResult && state.resultLine !== null) {
			yield { type: "result", resultLine: state.resultLine };
		}
	}
}
