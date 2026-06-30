import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStreamJson } from "../src/stream-parser.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

function loadFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("parseStreamJson — happy path (success.ndjson)", () => {
	const stdout = loadFixture("cc-stream.success.ndjson");
	const parsed = parseStreamJson(stdout);

	it("returns a non-null parsed result", () => {
		expect(parsed).not.toBeNull();
	});

	it("extracts the session id from the system line", () => {
		expect(parsed?.sessionId).toBe("a1b2c3d4-1111-2222-3333-444455556666");
	});

	it("extracts the model from the system line", () => {
		expect(parsed?.model).toBe("claude-sonnet-4-5");
	});

	it("emits both user and assistant turns in order", () => {
		expect(parsed?.turns.length).toBe(2);
		expect(parsed?.turns[0]?.role).toBe("user");
		expect(parsed?.turns[0]?.content).toBe("Say hi.");
		expect(parsed?.turns[0]?.index).toBe(0);
		expect(parsed?.turns[1]?.role).toBe("assistant");
		expect(parsed?.turns[1]?.content).toBe("Hi there!");
		expect(parsed?.turns[1]?.index).toBe(1);
	});

	it("populates subtype and usage from the result line", () => {
		expect(parsed?.subtype).toBe("success");
		expect(parsed?.usage.inputTokens).toBe(42);
		expect(parsed?.usage.outputTokens).toBe(7);
		expect(parsed?.totalCostUsd).toBeCloseTo(0.0042);
	});
});

describe("parseStreamJson — tool_use folded into ToolCall.output", () => {
	const stdout = loadFixture("cc-stream.tool-use.ndjson");
	const parsed = parseStreamJson(stdout);

	it("first assistant turn has a populated toolCalls array", () => {
		expect(parsed).not.toBeNull();
		const assistantTurn = parsed?.turns.find(
			(t) => t.role === "assistant" && t.toolCalls !== null,
		);
		expect(assistantTurn).toBeDefined();
		expect(assistantTurn?.toolCalls?.length).toBe(1);
		expect(assistantTurn?.toolCalls?.[0]?.id).toBe("toolu_abc1");
		expect(assistantTurn?.toolCalls?.[0]?.tool).toBe("Bash");
		expect(assistantTurn?.toolCalls?.[0]?.input).toEqual({
			command: "ls -la",
			description: "List files",
		});
	});

	it("matches the tool_result back into the ToolCall.output", () => {
		const toolCall = parsed?.turns.find((t) => t.toolCalls !== null)
			?.toolCalls?.[0];
		expect(toolCall?.output).toContain("total 0");
	});

	it("emits a progressive ToolTurnValue for the tool_result (#182)", () => {
		// 3 original turns + 1 progressive tool turn = 4
		expect(parsed?.turns.length).toBe(4);
		const toolTurn = parsed?.turns.find((t) => t.role === "tool");
		expect(toolTurn).toBeDefined();
		expect(toolTurn?.role).toBe("tool");
		expect((toolTurn as { callId?: string })?.callId).toBe("toolu_abc1");
		expect((toolTurn as { result?: string })?.result).toContain("total 0");
	});
});

describe("parseStreamJson — error_max_turns", () => {
	const stdout = loadFixture("cc-stream.max-turns.ndjson");
	const parsed = parseStreamJson(stdout);

	it("preserves the error_max_turns subtype", () => {
		expect(parsed?.subtype).toBe("error_max_turns");
	});

	it("still surfaces accumulated turns", () => {
		expect((parsed?.turns.length ?? 0) >= 1).toBe(true);
	});
});

describe("parseStreamJson — incomplete (no result line)", () => {
	const stdout = loadFixture("cc-stream.incomplete.ndjson");
	const parsed = parseStreamJson(stdout);

	it("returns a non-null result with subtype 'incomplete'", () => {
		expect(parsed).not.toBeNull();
		expect(parsed?.subtype).toBe("incomplete");
	});

	it("retains the parsed turns up to truncation", () => {
		expect((parsed?.turns.length ?? 0) >= 1).toBe(true);
	});
});

describe("parseStreamJson — malformed input", () => {
	it("returns null when no system or result line present", () => {
		const stdout = loadFixture("cc-stream.malformed.ndjson");
		const parsed = parseStreamJson(stdout);
		expect(parsed).toBeNull();
	});

	it("tolerates blank input (returns null)", () => {
		expect(parseStreamJson("")).toBeNull();
		expect(parseStreamJson("\n\n\n")).toBeNull();
	});

	it("ignores invalid JSON lines but parses valid ones", () => {
		const mixed = [
			"not-json",
			'{"type":"system","session_id":"abc","model":"claude-sonnet-4-5"}',
			'{"this is broken',
			'{"type":"result","subtype":"success","result":"ok","session_id":"abc","duration_ms":1,"total_cost_usd":0,"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}',
		].join("\n");
		const parsed = parseStreamJson(mixed);
		expect(parsed).not.toBeNull();
		expect(parsed?.sessionId).toBe("abc");
		expect(parsed?.subtype).toBe("success");
	});
});

describe("parseStreamJson — unknown subtype coercion", () => {
	it("coerces an unknown subtype to 'incomplete'", () => {
		const stdout = [
			'{"type":"system","session_id":"sess1","model":"claude-sonnet-4-5"}',
			'{"type":"result","subtype":"some_unknown_status","result":"x","session_id":"sess1","duration_ms":1,"total_cost_usd":0,"stop_reason":"end_turn","usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}',
		].join("\n");
		const parsed = parseStreamJson(stdout);
		expect(parsed?.subtype).toBe("incomplete");
	});
});
