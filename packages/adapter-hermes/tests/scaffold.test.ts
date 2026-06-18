import type { Adapter } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createHermesAdapter } from "../src/index.js";

describe("@sumeru/adapter-hermes — package scaffold", () => {
	it("createHermesAdapter() returns an object satisfying Adapter", () => {
		const adapter: Adapter = createHermesAdapter();
		expect(adapter.name).toBe("hermes");
		expect(typeof adapter.createSession).toBe("function");
		expect(typeof adapter.send).toBe("function");
		expect(typeof adapter.close).toBe("function");
		expect(typeof adapter.getTurns).toBe("function");
	});

	it("has no capabilities field (removed in streaming-first refactor)", () => {
		const adapter = createHermesAdapter();
		expect((adapter as Record<string, unknown>).capabilities).toBeUndefined();
	});

	it("accepts options object and applies sensible defaults", () => {
		const a1 = createHermesAdapter();
		const a2 = createHermesAdapter({ hermesBin: "/usr/local/bin/hermes" });
		expect(a1.name).toBe(a2.name);
	});
});
