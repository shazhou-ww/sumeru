import type { TurnValue } from "@sumeru/adapter-core";
import type { AssistantTurn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { wireTurnsToV3 } from "../src/wire-turn.js";

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
