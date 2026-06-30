import type { TurnValue, WireToolCall } from "@sumeru/adapter-core";
import type { AssistantTurn, ToolCall, ToolTurn, Turn } from "@sumeru/core";

export function turnRecordsToV3(
	records: Array<{ value: TurnValue }>,
): Array<Turn> {
	let nextId = 0;
	const turns: Array<Turn> = [];
	for (const record of records) {
		const mapped = wireTurnsToV3(record.value, nextId);
		nextId = mapped.nextId;
		turns.push(...mapped.turns);
	}
	return turns;
}

export function wireTurnsToV3(
	wire: TurnValue,
	startId: number,
): { turns: Array<Turn>; nextId: number } {
	if (wire.role === "system") {
		return { turns: [], nextId: startId };
	}
	if (wire.role === "user") {
		return { turns: [], nextId: startId };
	}

	// Pass adapter-reported usage through unchanged; null stays null so the
	// client can tell "unknown" apart from "zero consumption" (#178).
	const tokenUsage = wire.tokens;
	const mappedToolCalls = mapLegacyToolCalls(wire.toolCalls);
	let nextId = startId;
	const turns: Array<Turn> = [];

	const assistant: AssistantTurn = {
		id: nextId,
		role: "assistant",
		content: wire.content,
		toolCalls: mappedToolCalls.calls,
		tokenUsage,
		// Wall-clock duration measured/stamped by the host — never the sum of
		// tool-call durations (#178). Always a positive integer.
		durationMs: normalizeDurationMs(wire.durationMs),
		timestamp: wire.timestamp,
	};
	turns.push(assistant);
	nextId += 1;

	for (const toolTurn of mappedToolCalls.toolTurns) {
		turns.push({ ...toolTurn, id: nextId });
		nextId += 1;
	}

	return { turns, nextId };
}

function mapLegacyToolCalls(toolCalls: Array<WireToolCall> | null): {
	calls: Array<ToolCall>;
	toolTurns: Array<Omit<ToolTurn, "id">>;
} {
	if (toolCalls === null || toolCalls.length === 0) {
		return { calls: [], toolTurns: [] };
	}

	const calls: Array<ToolCall> = [];
	const toolTurns: Array<Omit<ToolTurn, "id">> = [];
	const timestamp = new Date().toISOString();

	for (let index = 0; index < toolCalls.length; index += 1) {
		const legacy = toolCalls[index];
		if (legacy === undefined) continue;
		const callId = `call_${index}`;
		calls.push({
			id: callId,
			name: legacy.tool,
			arguments: legacy.input,
		});
		if (legacy.output !== null) {
			toolTurns.push({
				role: "tool",
				callId,
				name: legacy.tool,
				result: legacy.output,
				durationMs: legacy.durationMs ?? 0,
				timestamp,
			});
		}
	}

	return { calls, toolTurns };
}

function normalizeDurationMs(durationMs: number | null): number {
	// An emitted assistant turn always took *some* wall-clock time, even a pure
	// "pong" with no tool calls. Clamp unknown/zero/sub-millisecond values up to
	// 1 so the contract (integer >= 1) holds (#178).
	if (durationMs === null || !Number.isFinite(durationMs)) return 1;
	return Math.max(1, Math.round(durationMs));
}
