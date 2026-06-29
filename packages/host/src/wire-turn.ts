import type { AssistantTurn, TokenUsage, ToolCall, ToolTurn, Turn } from "@sumeru/core";
import type { WireToolCall, TurnValue } from "@sumeru/adapter-core";

const EMPTY_TOKEN_USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };

export function turnRecordsToV3(records: Array<{ value: TurnValue }>): Array<Turn> {
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

	const tokenUsage = wire.tokens ?? EMPTY_TOKEN_USAGE;
	const mappedToolCalls = mapLegacyToolCalls(wire.toolCalls);
	let nextId = startId;
	const turns: Array<Turn> = [];

	const assistant: AssistantTurn = {
		id: nextId,
		role: "assistant",
		content: wire.content,
		toolCalls: mappedToolCalls.calls,
		tokenUsage,
		durationMs: sumToolDuration(wire.toolCalls),
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

function sumToolDuration(toolCalls: Array<WireToolCall> | null): number {
	if (toolCalls === null) return 0;
	let total = 0;
	for (const call of toolCalls) {
		if (call.durationMs !== null) {
			total += call.durationMs;
		}
	}
	return total;
}
