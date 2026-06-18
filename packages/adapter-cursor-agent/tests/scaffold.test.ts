import type { Adapter } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { fakeSpawn } from "./test-utils.js";

describe("adapter scaffold", () => {
	it("createCursorAgentAdapter() satisfies the Adapter type", () => {
		const { spawnFn } = fakeSpawn({});
		const adapter: Adapter = createCursorAgentAdapter({ spawnFn });
		expect(adapter.name).toBe("cursor-agent");
		expect(typeof adapter.createSession).toBe("function");
		expect(typeof adapter.send).toBe("function");
		expect(typeof adapter.close).toBe("function");
		expect(typeof adapter.getTurns).toBe("function");
	});

	it("factory returns independent instances", () => {
		const { spawnFn } = fakeSpawn({});
		const a = createCursorAgentAdapter({ spawnFn });
		const b = createCursorAgentAdapter({ spawnFn });
		expect(a).not.toBe(b);
	});
});
