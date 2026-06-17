import type { Adapter } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";

describe("@sumeru/adapter-codex — package scaffold", () => {
	it("createCodexAdapter() returns an object satisfying Adapter", () => {
		const adapter: Adapter = createCodexAdapter();
		expect(adapter.name).toBe("codex");
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
		const a1 = createCodexAdapter();
		const a2 = createCodexAdapter({
			codexBin: "/usr/local/bin/codex",
			model: "o3",
		});
		expect(a1.name).toBe(a2.name);
		expect(a1.capabilities).toEqual(a2.capabilities);
	});
});
