import { describe, expect, it } from "vitest";
import { parseCodexJson } from "../src/index.js";
import { loadFixture } from "./test-utils.js";

describe("parseCodexJson()", () => {
	it("parses success fixture correctly", () => {
		const result = parseCodexJson(loadFixture("codex-stream.success.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("codex-session-001");
		expect(result?.model).toBe("o3");
		expect(result?.subtype).toBe("success");
		expect(result?.turns.length).toBe(2); // user + assistant
		expect(result?.turns[0]?.role).toBe("user");
		expect(result?.turns[1]?.role).toBe("assistant");
		expect(result?.usage.inputTokens).toBe(42);
		expect(result?.usage.outputTokens).toBe(7);
	});

	it("parses resume fixture with tool calls", () => {
		const result = parseCodexJson(loadFixture("codex-stream.resume.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("codex-session-002");
		expect(result?.turns.length).toBeGreaterThan(0);

		// Find the turn with tool calls
		const turnWithTools = result?.turns.find(
			(t) => t.toolCalls !== null && t.toolCalls.length > 0,
		);
		expect(turnWithTools).toBeDefined();
		expect(turnWithTools?.toolCalls?.[0]?.tool).toBe("shell");
		expect(turnWithTools?.toolCalls?.[0]?.output).toBe("hello");
	});

	it("parses tool-use fixture correctly", () => {
		const result = parseCodexJson(loadFixture("codex-stream.tool-use.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("codex-session-003");

		const toolTurn = result?.turns.find(
			(t) => t.toolCalls !== null && t.toolCalls.length > 0,
		);
		expect(toolTurn).toBeDefined();
		expect(toolTurn?.toolCalls?.[0]?.tool).toBe("file_write");
		expect(toolTurn?.toolCalls?.[0]?.output).toBe("File written successfully.");
	});

	it("parses incomplete fixture (no result line) with sessionId", () => {
		const result = parseCodexJson(loadFixture("codex-stream.incomplete.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("codex-session-incomplete");
		expect(result?.subtype).toBe("incomplete");
		expect(result?.turns.length).toBeGreaterThan(0);
	});

	it("returns null for malformed/unparseable output", () => {
		const result = parseCodexJson(loadFixture("codex-stream.malformed.jsonl"));
		expect(result).toBeNull();
	});

	it("returns null for empty string", () => {
		const result = parseCodexJson("");
		expect(result).toBeNull();
	});

	it("is deterministic (same input → same output)", () => {
		const input = loadFixture("codex-stream.success.jsonl");
		const r1 = parseCodexJson(input);
		const r2 = parseCodexJson(input);

		// Compare everything except timestamp
		expect(r1?.sessionId).toBe(r2?.sessionId);
		expect(r1?.model).toBe(r2?.model);
		expect(r1?.subtype).toBe(r2?.subtype);
		expect(r1?.turns.length).toBe(r2?.turns.length);
		expect(r1?.usage).toEqual(r2?.usage);
	});

	it("handles max_turns error subtype", () => {
		const result = parseCodexJson(loadFixture("codex-stream.max-turns.jsonl"));
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("codex-max-turns");
		expect(result?.subtype).toBe("error");
		expect(result?.stopReason).toBe("max_turns");
	});

	it("tolerates extra/unknown fields", () => {
		const jsonl = [
			'{"type":"session.start","session_id":"test","model":"o3","extra_field":"ignored"}',
			'{"type":"user","role":"user","content":"hi","metadata":{"foo":"bar"}}',
			'{"type":"result","subtype":"success","session_id":"test","usage":{"input_tokens":1,"output_tokens":1},"custom":123}',
		].join("\n");

		const result = parseCodexJson(jsonl);
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("test");
	});

	it("extracts session_id from result line if not in session.start", () => {
		const jsonl = [
			'{"type":"user","role":"user","content":"hi"}',
			'{"type":"assistant","role":"assistant","content":"hello"}',
			'{"type":"result","subtype":"success","session_id":"from-result","usage":{"input_tokens":1,"output_tokens":1}}',
		].join("\n");

		const result = parseCodexJson(jsonl);
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("from-result");
	});
});
