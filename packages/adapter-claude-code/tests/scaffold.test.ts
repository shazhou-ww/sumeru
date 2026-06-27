import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/adapter.js";
import { parseStreamJson } from "../src/stream-parser.js";

describe("@sumeru/adapter-claude-code — package surface", () => {
	it("exports createClaudeCodeAdapter returning AdapterImpl shape", () => {
		const adapter = createClaudeCodeAdapter();
		expect(typeof adapter.init).toBe("function");
		expect(typeof adapter.handle).toBe("function");
	});

	it("parseStreamJson is exported from the package barrel", () => {
		expect(typeof parseStreamJson).toBe("function");
	});
});
