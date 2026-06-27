import { describe, expect, it } from "vitest";
import { parseStreamJson } from "../src/stream-parser.js";
import { loadFixture } from "./test-utils.js";

describe("parseStreamJson", () => {
	describe("simple fixture (no tool calls)", () => {
		it("parses system + user + assistant + result into turns", () => {
			const text = loadFixture("ca-stream.simple.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			expect(result?.sessionId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
			expect(result?.model).toBe("claude-sonnet-4");
			expect(result?.subtype).toBe("success");
			expect(result?.durationMs).toBe(2345);
			expect(result?.usage.inputTokens).toBe(150);
			expect(result?.usage.outputTokens).toBe(25);
			expect(result?.turns.length).toBe(2); // user + assistant
			expect(result?.turns[0]?.role).toBe("user");
			expect(result?.turns[0]?.content).toBe("Say hi.");
			expect(result?.turns[1]?.role).toBe("assistant");
			expect(result?.turns[1]?.content).toBe(
				"Hello! How can I help you today?",
			);
		});

		it("turns have monotonically increasing indices starting at 0", () => {
			const text = loadFixture("ca-stream.simple.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			for (let i = 0; i < (result?.turns.length ?? 0); i++) {
				expect(result?.turns[i]?.index).toBe(i);
			}
		});

		it("turns have null toolCalls when no tool calls present", () => {
			const text = loadFixture("ca-stream.simple.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			for (const turn of result?.turns ?? []) {
				expect(turn.toolCalls).toBeNull();
			}
		});
	});

	describe("edit-tool fixture", () => {
		it("maps editToolCall started+completed to ToolCall with output", () => {
			const text = loadFixture("ca-stream.edit-tool.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			expect(result?.sessionId).toBe("edit-session-001");

			// Find the assistant turn with tool calls
			const turnWithTools = result?.turns.find(
				(t) => t.toolCalls !== null && t.toolCalls.length > 0,
			);
			expect(turnWithTools).toBeDefined();
			expect(turnWithTools?.toolCalls?.[0]?.tool).toBe("editToolCall");
			expect(turnWithTools?.toolCalls?.[0]?.input).toEqual({
				filePath: "/workspace/hello.ts",
				content: 'export const greeting = "Hello, world!";\n',
			});
			expect(turnWithTools?.toolCalls?.[0]?.output).toBe(
				"File created successfully",
			);
		});

		it("editToolCall has exitCode null", () => {
			const text = loadFixture("ca-stream.edit-tool.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			const turnWithTools = result?.turns.find(
				(t) => t.toolCalls !== null && t.toolCalls.length > 0,
			);
			expect(turnWithTools?.toolCalls?.[0]?.exitCode).toBeNull();
		});

		it("thinking lines are discarded — no Turn with reasoning text", () => {
			const text = loadFixture("ca-stream.edit-tool.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			for (const turn of result?.turns ?? []) {
				expect(turn.content).not.toContain("I need to create a file");
				expect(turn.content).not.toContain(
					"I'll create a hello.ts file with a greeting",
				);
			}
		});
	});

	describe("shell-tool fixture", () => {
		it("maps shellToolCall started+completed to ToolCall with stdout and exitCode", () => {
			const text = loadFixture("ca-stream.shell-tool.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			expect(result?.sessionId).toBe("shell-session-001");

			const turnWithTools = result?.turns.find(
				(t) => t.toolCalls !== null && t.toolCalls.length > 0,
			);
			expect(turnWithTools).toBeDefined();
			expect(turnWithTools?.toolCalls?.[0]?.tool).toBe("shellToolCall");
			expect(turnWithTools?.toolCalls?.[0]?.output).toContain("hello.ts");
			expect(turnWithTools?.toolCalls?.[0]?.exitCode).toBe(0);
		});

		it("shellToolCall input contains args", () => {
			const text = loadFixture("ca-stream.shell-tool.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			const turnWithTools = result?.turns.find(
				(t) => t.toolCalls !== null && t.toolCalls.length > 0,
			);
			expect(turnWithTools?.toolCalls?.[0]?.input).toEqual({
				command: "ls",
				args: ["-la"],
			});
		});
	});

	describe("incomplete fixture (no result line)", () => {
		it("returns result with subtype incomplete when system line present but no result line", () => {
			const text = loadFixture("ca-stream.incomplete.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			expect(result?.subtype).toBe("incomplete");
			expect(result?.sessionId).toBe("incomplete-session-001");
			expect(result?.result).toBe(
				"I was working on something but got interrupted.",
			);
			expect(result?.durationMs).toBe(0);
			expect(result?.usage.inputTokens).toBe(0);
		});
	});

	describe("no-session fixture (garbage only)", () => {
		it("returns null when no system line with session_id is found", () => {
			const text = loadFixture("ca-stream.no-session.ndjson");
			const result = parseStreamJson(text);
			expect(result).toBeNull();
		});
	});

	describe("malformed fixture (valid + invalid lines mixed)", () => {
		it("skips malformed lines and still parses valid ones", () => {
			const text = loadFixture("ca-stream.malformed.ndjson");
			const result = parseStreamJson(text);
			expect(result).not.toBeNull();
			expect(result?.sessionId).toBe("malformed-session-001");
			expect(result?.subtype).toBe("success");
			// Should have user + assistant turns (malformed lines skipped)
			expect(result?.turns.length).toBe(2);
		});
	});

	describe("tool-call pairing edge cases", () => {
		it("unmatched started keeps output null", () => {
			const lines = [
				JSON.stringify({
					type: "system",
					subtype: "init",
					session_id: "pair-test-001",
					model: "claude-sonnet-4",
					cwd: "/workspace",
				}),
				JSON.stringify({
					type: "assistant",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Let me do that." }],
					},
				}),
				JSON.stringify({
					type: "tool_call",
					subtype: "started",
					call_id: "orphan_001",
					tool_call: {
						editToolCall: {
							args: { filePath: "/tmp/x.ts", content: "x" },
						},
					},
				}),
				// No matching completed event
				JSON.stringify({
					type: "result",
					subtype: "success",
					result: "done",
					duration_ms: 100,
					usage: {
						inputTokens: 10,
						outputTokens: 5,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				}),
			].join("\n");
			const result = parseStreamJson(lines);
			expect(result).not.toBeNull();
			const turnWithTools = result?.turns.find(
				(t) => t.toolCalls !== null && t.toolCalls.length > 0,
			);
			expect(turnWithTools).toBeDefined();
			expect(turnWithTools?.toolCalls?.[0]?.output).toBeNull();
		});

		it("unmatched completed is silently dropped", () => {
			const lines = [
				JSON.stringify({
					type: "system",
					subtype: "init",
					session_id: "pair-test-002",
					model: "claude-sonnet-4",
					cwd: "/workspace",
				}),
				JSON.stringify({
					type: "assistant",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Hello" }],
					},
				}),
				JSON.stringify({
					type: "tool_call",
					subtype: "completed",
					call_id: "no_match_001",
					tool_call: {
						editToolCall: { result: { content: "done" } },
					},
				}),
				JSON.stringify({
					type: "result",
					subtype: "success",
					result: "Hello",
					duration_ms: 50,
					usage: {
						inputTokens: 5,
						outputTokens: 3,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				}),
			].join("\n");
			const result = parseStreamJson(lines);
			expect(result).not.toBeNull();
			// The assistant turn should exist without tool calls since the completed was dropped
			expect(result?.turns[0]?.toolCalls).toBeNull();
		});

		it("multiple tool_call events between two assistant lines all attach to the most recent", () => {
			const lines = [
				JSON.stringify({
					type: "system",
					subtype: "init",
					session_id: "multi-tool-001",
					model: "claude-sonnet-4",
					cwd: "/workspace",
				}),
				JSON.stringify({
					type: "assistant",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "I'll do both." }],
					},
				}),
				JSON.stringify({
					type: "tool_call",
					subtype: "started",
					call_id: "tc_a",
					tool_call: {
						editToolCall: { args: { filePath: "/a.ts", content: "a" } },
					},
				}),
				JSON.stringify({
					type: "tool_call",
					subtype: "started",
					call_id: "tc_b",
					tool_call: {
						shellToolCall: { args: { command: "echo", args: ["b"] } },
					},
				}),
				JSON.stringify({
					type: "tool_call",
					subtype: "completed",
					call_id: "tc_a",
					tool_call: { editToolCall: { result: { content: "ok a" } } },
				}),
				JSON.stringify({
					type: "tool_call",
					subtype: "completed",
					call_id: "tc_b",
					tool_call: {
						shellToolCall: { result: { stdout: "b\n", exitCode: 0 } },
					},
				}),
				JSON.stringify({
					type: "result",
					subtype: "success",
					result: "done",
					duration_ms: 200,
					usage: {
						inputTokens: 20,
						outputTokens: 10,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				}),
			].join("\n");
			const result = parseStreamJson(lines);
			expect(result).not.toBeNull();
			const assistantTurn = result?.turns.find((t) => t.role === "assistant");
			expect(assistantTurn?.toolCalls).not.toBeNull();
			expect(assistantTurn?.toolCalls?.length).toBe(2);
			expect(assistantTurn?.toolCalls?.[0]?.tool).toBe("editToolCall");
			expect(assistantTurn?.toolCalls?.[0]?.output).toBe("ok a");
			expect(assistantTurn?.toolCalls?.[1]?.tool).toBe("shellToolCall");
			expect(assistantTurn?.toolCalls?.[1]?.output).toContain("b\n");
			expect(assistantTurn?.toolCalls?.[1]?.exitCode).toBe(0);
		});
	});

	describe("robustness", () => {
		it("parseStreamJson('') returns null", () => {
			expect(parseStreamJson("")).toBeNull();
		});

		it("parseStreamJson('not-json\\n') returns null", () => {
			expect(parseStreamJson("not-json\n")).toBeNull();
		});

		it("determinism: parsing the same input twice returns deeply equal objects", () => {
			const text = loadFixture("ca-stream.edit-tool.ndjson");
			const a = parseStreamJson(text);
			const b = parseStreamJson(text);
			// Timestamps differ (per-call `now`), so compare structure without timestamp
			expect(a?.sessionId).toBe(b?.sessionId);
			expect(a?.turns.length).toBe(b?.turns.length);
			expect(a?.usage).toEqual(b?.usage);
			expect(a?.subtype).toBe(b?.subtype);
			for (let i = 0; i < (a?.turns.length ?? 0); i++) {
				expect(a?.turns[i]?.content).toBe(b?.turns[i]?.content);
				expect(a?.turns[i]?.role).toBe(b?.turns[i]?.role);
				expect(a?.turns[i]?.index).toBe(b?.turns[i]?.index);
			}
		});
	});
});
