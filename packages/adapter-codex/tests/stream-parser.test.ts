import { describe, expect, it } from "vitest";
import { parseCodexJson } from "../src/index.js";
import { loadFixture } from "./test-utils.js";

describe("parseCodexJson()", () => {
	it("parses success fixture correctly", () => {
		const result = parseCodexJson(loadFixture("codex-stream.success.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
		expect(result?.model).toBe("");
		expect(result?.subtype).toBe("success");
		expect(result?.numTurns).toBe(3);
		expect(result?.turns.length).toBe(3);
		// Turn 0: agent_message — "I'll create..."
		expect(result?.turns[0]?.role).toBe("assistant");
		expect(result?.turns[0]?.content).toContain("I’ll create");
		expect(result?.turns[0]?.toolCalls).toBeNull();
		// Turn 1: command_execution
		expect(result?.turns[1]?.role).toBe("assistant");
		expect(result?.turns[1]?.content).toBe("");
		expect(result?.turns[1]?.toolCalls).not.toBeNull();
		expect(result?.turns[1]?.toolCalls?.[0]?.tool).toBe("command_execution");
		expect(result?.turns[1]?.toolCalls?.[0]?.input).toEqual({
			command: expect.stringContaining("printf 'Hello World"),
		});
		expect(result?.turns[1]?.toolCalls?.[0]?.output).toBe("Hello World\n");
		expect(result?.turns[1]?.toolCalls?.[0]?.exitCode).toBe(0);
		// Turn 2: agent_message — "created and read successfully"
		expect(result?.turns[2]?.role).toBe("assistant");
		expect(result?.turns[2]?.content).toContain(
			"created and read successfully",
		);
		expect(result?.turns[2]?.toolCalls).toBeNull();
		// Usage
		expect(result?.usage.inputTokens).toBe(17677);
		expect(result?.usage.outputTokens).toBe(97);
		// Stop reason
		expect(result?.stopReason).toBe("turn_completed");
		// Result text = last agent_message content
		expect(result?.result).toContain("created and read successfully");
	});

	it("parses simple fixture (no tool use)", () => {
		const result = parseCodexJson(loadFixture("codex-stream.simple.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("019eee32-d812-7f31-bb4b-f43b1abd7b13");
		expect(result?.subtype).toBe("success");
		expect(result?.numTurns).toBe(1);
		expect(result?.turns[0]?.role).toBe("assistant");
		expect(result?.turns[0]?.content).toBe("4");
		expect(result?.turns[0]?.toolCalls).toBeNull();
		expect(result?.usage.inputTokens).toBe(8774);
		expect(result?.usage.outputTokens).toBe(5);
	});

	it("parses resume fixture correctly", () => {
		const result = parseCodexJson(loadFixture("codex-stream.resume.jsonl"));
		expect(result).not.toBeNull();
		// Same thread_id as the original session
		expect(result?.sessionId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
		expect(result?.subtype).toBe("success");
		expect(result?.numTurns).toBe(3);
		// Turn 1 should have command_execution with "hello.txt is gone"
		expect(result?.turns[1]?.toolCalls?.[0]?.output).toContain(
			"hello.txt is gone",
		);
		expect(result?.usage.inputTokens).toBe(35690);
	});

	it("parses incomplete fixture (no turn.completed)", () => {
		const result = parseCodexJson(loadFixture("codex-stream.incomplete.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
		expect(result?.subtype).toBe("incomplete");
		expect(result?.numTurns).toBe(3);
		expect(result?.usage.inputTokens).toBe(0);
		expect(result?.usage.outputTokens).toBe(0);
		expect(result?.stopReason).toBe("incomplete_no_result_line");
	});

	it("parses malformed fixture — skips invalid lines", () => {
		const result = parseCodexJson(loadFixture("codex-stream.malformed.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
		expect(result?.subtype).toBe("success");
		// Only the valid agent_message before malformed lines produces a turn
		expect(result?.numTurns).toBe(1);
		expect(result?.usage.inputTokens).toBe(100);
		expect(result?.usage.outputTokens).toBe(5);
	});

	it("returns null for empty string", () => {
		const result = parseCodexJson("");
		expect(result).toBeNull();
	});

	it("returns null when no JSON is parseable", () => {
		const result = parseCodexJson("not json\nalso not json");
		expect(result).toBeNull();
	});

	it("is deterministic (same input → same output)", () => {
		const input = loadFixture("codex-stream.success.jsonl");
		const r1 = parseCodexJson(input);
		const r2 = parseCodexJson(input);

		expect(r1?.sessionId).toBe(r2?.sessionId);
		expect(r1?.model).toBe(r2?.model);
		expect(r1?.subtype).toBe(r2?.subtype);
		expect(r1?.turns.length).toBe(r2?.turns.length);
		expect(r1?.usage).toEqual(r2?.usage);
		for (let i = 0; i < (r1?.turns.length ?? 0); i++) {
			expect(r1?.turns[i]?.role).toBe(r2?.turns[i]?.role);
			expect(r1?.turns[i]?.content).toBe(r2?.turns[i]?.content);
			expect(r1?.turns[i]?.index).toBe(r2?.turns[i]?.index);
		}
	});

	it("skips non-JSON first line (stdin message)", () => {
		const input = loadFixture("codex-stream.success.jsonl");
		// The success fixture starts with "Reading additional input from stdin..."
		expect(input.startsWith("Reading")).toBe(true);
		const result = parseCodexJson(input);
		// Still parses correctly
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
	});

	it("item.started events (status: in_progress) do NOT produce turns", () => {
		// The success fixture has an item.started event for the command_execution
		const input = loadFixture("codex-stream.success.jsonl");
		const result = parseCodexJson(input);
		// If item.started produced a turn, we'd have 4 turns instead of 3
		expect(result?.numTurns).toBe(3);
	});

	it("tool-call extraction: correct command, output, exitCode", () => {
		const result = parseCodexJson(loadFixture("codex-stream.success.jsonl"));
		const toolTurn = result?.turns[1];
		expect(toolTurn).toBeDefined();
		expect(toolTurn?.toolCalls).not.toBeNull();
		expect(toolTurn?.toolCalls?.length).toBe(1);
		const tc = toolTurn?.toolCalls?.[0];
		expect(tc?.tool).toBe("command_execution");
		expect(tc?.input).toHaveProperty("command");
		expect((tc?.input as Record<string, unknown>).command).toContain(
			"printf 'Hello World",
		);
		expect(tc?.output).toBe("Hello World\n");
		expect(tc?.exitCode).toBe(0);
		expect(tc?.durationMs).toBeNull();
	});

	it("tolerates extra/unknown event types silently", () => {
		const jsonl = [
			'{"type":"thread.started","thread_id":"test-extra"}',
			'{"type":"turn.started"}',
			'{"type":"unknown_event","data":"ignored"}',
			'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hi"}}',
			'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"cached_input_tokens":0,"reasoning_output_tokens":0}}',
		].join("\n");

		const result = parseCodexJson(jsonl);
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("test-extra");
		expect(result?.numTurns).toBe(1);
	});

	it("unknown item types in item.completed are silently skipped", () => {
		const jsonl = [
			'{"type":"thread.started","thread_id":"test-unknown-item"}',
			'{"type":"item.completed","item":{"id":"item_0","type":"unknown_item_type","data":"foo"}}',
			'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"hello"}}',
			'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"cached_input_tokens":0,"reasoning_output_tokens":0}}',
		].join("\n");

		const result = parseCodexJson(jsonl);
		expect(result).not.toBeNull();
		// Only the agent_message produces a turn
		expect(result?.numTurns).toBe(1);
		expect(result?.turns[0]?.content).toBe("hello");
	});
});
