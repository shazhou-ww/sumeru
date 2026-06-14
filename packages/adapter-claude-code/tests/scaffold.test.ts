import type { Adapter } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";

describe("@sumeru/adapter-claude-code — package scaffold", () => {
	it("createClaudeCodeAdapter() returns an object satisfying Adapter", () => {
		const adapter: Adapter = createClaudeCodeAdapter();
		expect(adapter.name).toBe("claude-code");
		expect(adapter.capabilities).toEqual({
			resume: true,
			streaming: false,
		});
		expect(typeof adapter.createSession).toBe("function");
		expect(typeof adapter.send).toBe("function");
		expect(typeof adapter.close).toBe("function");
		expect(typeof adapter.getTurns).toBe("function");
	});

	it("accepts options object and applies sensible defaults", () => {
		const a1 = createClaudeCodeAdapter();
		const a2 = createClaudeCodeAdapter({
			claudeBin: "/usr/local/bin/claude",
			model: "claude-sonnet-4-5",
			maxTurns: 50,
		});
		expect(a1.name).toBe(a2.name);
		expect(a1.capabilities).toEqual(a2.capabilities);
	});
});
