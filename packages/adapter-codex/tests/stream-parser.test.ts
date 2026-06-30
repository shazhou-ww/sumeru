import { describe, expect, it } from "vitest";
import { parseCodexJson } from "../src/stream-parser.js";

describe("parseCodexJson — command_execution", () => {
	const JSONL = [
		'{"type":"thread.started","thread_id":"thread_cmd"}',
		'{"type":"item.completed","item":{"type":"command_execution","id":"exec_1","status":"completed","command":"echo hello","aggregated_output":"hello\\n","exit_code":0}}',
		'{"type":"turn.completed","usage":{"input_tokens":15,"output_tokens":8}}',
	].join("\n");

	const parsed = parseCodexJson(JSONL);

	it("returns a non-null result", () => {
		expect(parsed).not.toBeNull();
	});

	it("emits an assistant turn with toolCalls", () => {
		const turn = parsed?.turns.find((t) => t.toolCalls !== null);
		expect(turn).toBeDefined();
		expect(turn?.role).toBe("assistant");
		expect(turn?.toolCalls?.length).toBe(1);
	});

	it("populates WireToolCall with id, tool, input, output, exitCode", () => {
		const tc = parsed?.turns.find((t) => t.toolCalls !== null)
			?.toolCalls?.[0];
		expect(tc?.id).toBe("exec_1");
		expect(tc?.tool).toBe("command_execution");
		expect(tc?.input).toEqual({ command: "echo hello" });
		expect(tc?.output).toBe("hello\n");
		expect(tc?.exitCode).toBe(0);
	});

	it("ignores non-completed command_execution items", () => {
		const jsonl = [
			'{"type":"thread.started","thread_id":"thread_skip"}',
			'{"type":"item.completed","item":{"type":"command_execution","id":"exec_2","status":"running","command":"sleep 10","aggregated_output":"","exit_code":null}}',
			'{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}',
		].join("\n");
		const result = parseCodexJson(jsonl);
		expect(result).not.toBeNull();
		const toolTurns = result?.turns.filter((t) => t.toolCalls !== null) ?? [];
		expect(toolTurns.length).toBe(0);
	});

	it("generates a UUID when item.id is missing", () => {
		const jsonl = [
			'{"type":"thread.started","thread_id":"thread_noid"}',
			'{"type":"item.completed","item":{"type":"command_execution","status":"completed","command":"pwd","aggregated_output":"/tmp\\n","exit_code":0}}',
			'{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}',
		].join("\n");
		const result = parseCodexJson(jsonl);
		const tc = result?.turns.find((t) => t.toolCalls !== null)
			?.toolCalls?.[0];
		expect(tc?.id).toBeDefined();
		expect(typeof tc?.id).toBe("string");
		expect(tc?.id?.length).toBeGreaterThan(0);
	});
});
