/**
 * JSONL parser for Codex CLI's `codex exec --json` output.
 */

import type { DoneValue, WireToolCall, TurnValue } from "@sumeru/adapter-core";
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
	turns: Array<TurnValue>;
	resultLine: Record<string, unknown> | null;
	model: string;
	sessionId: string;
	turnIndex: number;
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
		const turn: TurnValue = {
			index: state.turnIndex++,
			role: "assistant",
			content: text,
			timestamp: state.now,
			toolCalls: null,
			tokens: null,
		};
		state.turns.push(turn);
		return;
	}

	if (itemType === "command_execution") {
		const status = safeString(item.status);
		if (status !== "completed") return;

		const command = safeString(item.command);
		const aggregatedOutput = safeString(item.aggregated_output);
		const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;

		const toolCall: WireToolCall = {
			tool: "command_execution",
			input: { command },
			output: aggregatedOutput,
			durationMs: null,
			exitCode,
		};

		const turn: TurnValue = {
			index: state.turnIndex++,
			role: "assistant",
			content: "",
			timestamp: state.now,
			toolCalls: [toolCall],
			tokens: null,
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
	}
}

function extractLastAssistantContent(turns: Array<TurnValue>): string {
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
	if (state.resultLine === null && state.sessionId === "") return null;

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

	const usage = isRecord(state.resultLine.usage)
		? state.resultLine.usage
		: state.resultLine;

	return {
		type: "result",
		subtype: "success",
		result: extractLastAssistantContent(state.turns),
		sessionId: state.sessionId,
		numTurns: state.turns.length,
		durationMs: 0,
		model: state.model,
		stopReason: "turn_completed",
		usage: {
			inputTokens: safeNumber(usage.input_tokens),
			outputTokens: safeNumber(usage.output_tokens),
		},
		turns: state.turns,
	};
}

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

export function doneValueFromResultLine(
	resultLine: Record<string, unknown> | null,
): DoneValue {
	if (resultLine === null) {
		return { summary: null, tokenUsage: null };
	}
	const usage = isRecord(resultLine.usage) ? resultLine.usage : resultLine;
	const input = safeNumber(usage.input_tokens);
	const output = safeNumber(usage.output_tokens);
	const cached = safeNumber(usage.cache_read_input_tokens);
	const tokenUsage =
		input === 0 && output === 0 && cached === 0
			? null
			: { input, output, cached };
	return { summary: null, tokenUsage };
}

export type { CodexResultSubtype };
