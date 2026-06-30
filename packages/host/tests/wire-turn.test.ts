import type { TurnValue } from "@sumeru/adapter-core";
import type { AssistantTurn, ToolTurn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { turnRecordsToV3, wireTurnsToV3 } from "../src/wire-turn.js";

function assistantWire(overrides: Partial<TurnValue> = {}): TurnValue {
	return {
		index: 0,
		role: "assistant",
		content: "pong",
		timestamp: "2026-06-30T02:19:18.903Z",
		toolCalls: null,
		tokens: null,
		durationMs: null,
		...overrides,
	};
}

describe("wireTurnsToV3 — durationMs (bug #178)", () => {
	it("uses the host-measured wall-clock durationMs, not sumToolDuration", () => {
		// Wall-clock is 47ms; tool calls (if any) would sum to 999ms.
		const wire = assistantWire({
			durationMs: 47,
			toolCalls: [
				{
					tool: "bash",
					input: { cmd: "sleep" },
					output: "done",
					durationMs: 999,
					exitCode: 0,
				},
			],
		});

		const { turns } = wireTurnsToV3(wire, 0);
		const assistant = turns.find(
			(turn): turn is AssistantTurn => turn.role === "assistant",
		);

		expect(assistant?.durationMs).toBe(47);
		expect(assistant?.durationMs).not.toBe(999);
	});

	it("yields a positive integer durationMs for a pure-text turn (no tool calls)", () => {
		const wire = assistantWire({ durationMs: 47, toolCalls: null });

		const { turns } = wireTurnsToV3(wire, 0);
		const assistant = turns[0] as AssistantTurn;

		expect(assistant.durationMs).toBeGreaterThanOrEqual(1);
		expect(Number.isInteger(assistant.durationMs)).toBe(true);
	});

	it("normalizes a measured durationMs to an integer >= 1", () => {
		const wire = assistantWire({ durationMs: 0.4 });

		const { turns } = wireTurnsToV3(wire, 0);
		const assistant = turns[0] as AssistantTurn;

		expect(assistant.durationMs).toBe(1);
	});
});

describe("wireTurnsToV3 — tokenUsage passthrough (bug #178)", () => {
	it("passes adapter-reported tokenUsage through unchanged", () => {
		const wire = assistantWire({
			tokens: { input: 100, output: 20, cached: 0 },
		});

		const { turns } = wireTurnsToV3(wire, 0);
		const assistant = turns[0] as AssistantTurn;

		expect(assistant.tokenUsage).toEqual({ input: 100, output: 20, cached: 0 });
	});

	it("emits tokenUsage === null when the adapter reported no tokens", () => {
		const wire = assistantWire({ tokens: null });

		const { turns } = wireTurnsToV3(wire, 0);
		const assistant = turns[0] as AssistantTurn;

		expect(assistant.tokenUsage).toBeNull();
		// Must NOT fabricate a zero-usage object.
		expect(assistant.tokenUsage).not.toEqual({
			input: 0,
			output: 0,
			cached: 0,
		});
	});
});

describe("wireTurnsToV3 — role:tool passthrough (#182)", () => {
	function toolWire(overrides: Partial<TurnValue> = {}): TurnValue {
		return {
			index: 1,
			role: "tool",
			name: "terminal",
			callId: "tc_1",
			result: "file1.txt file2.txt",
			durationMs: 150,
			timestamp: "2026-06-30T02:19:18.903Z",
			...overrides,
		} as TurnValue;
	}

	it("surfaces a wire role:tool frame as a public ToolTurn", () => {
		const { turns, nextId } = wireTurnsToV3(toolWire(), 5);

		expect(turns).toHaveLength(1);
		const tool = turns[0] as ToolTurn;
		expect(tool).toEqual({
			id: 5,
			role: "tool",
			callId: "tc_1",
			name: "terminal",
			result: "file1.txt file2.txt",
			durationMs: 150,
			timestamp: "2026-06-30T02:19:18.903Z",
		});
		expect(nextId).toBe(6);
		// ToolTurn must NOT carry assistant-only fields.
		expect("content" in tool).toBe(false);
		expect("toolCalls" in tool).toBe(false);
		expect("tokenUsage" in tool).toBe(false);
	});

	it("normalizes a tool turn durationMs to an integer >= 1", () => {
		const { turns } = wireTurnsToV3(toolWire({ durationMs: 0 }), 0);
		const tool = turns[0] as ToolTurn;
		expect(tool.durationMs).toBeGreaterThanOrEqual(1);
		expect(Number.isInteger(tool.durationMs)).toBe(true);
	});

	it("threads ids across a progressive assistant→tool→assistant sequence", () => {
		const assistant1: TurnValue = {
			index: 0,
			role: "assistant",
			content: "让我查看一下...",
			timestamp: "2026-06-30T02:19:18.903Z",
			toolCalls: [
				{
					tool: "terminal",
					input: { command: "ls /tmp" },
					output: null,
					durationMs: null,
					exitCode: null,
				},
			],
			tokens: null,
			durationMs: 5,
		};
		const tool = toolWire();
		const assistant2: TurnValue = {
			index: 2,
			role: "assistant",
			content: "目录下有 file1.txt 和 file2.txt",
			timestamp: "2026-06-30T02:19:19.903Z",
			toolCalls: null,
			tokens: null,
			durationMs: 5,
		};

		const turns = turnRecordsToV3([
			{ value: assistant1 },
			{ value: tool },
			{ value: assistant2 },
		]);

		// The role:tool frame yields its own ToolTurn (not derived from the
		// assistant's toolCalls[], whose output is null here).
		const roles = turns.map((t) => t.role);
		expect(roles).toEqual(["assistant", "tool", "assistant"]);
		const toolTurn = turns.find((t): t is ToolTurn => t.role === "tool");
		expect(toolTurn?.callId).toBe("tc_1");
		expect(toolTurn?.result).toBe("file1.txt file2.txt");
		// ids are unique and monotonically increasing.
		expect(turns.map((t) => t.id)).toEqual([0, 1, 2]);
	});
});
