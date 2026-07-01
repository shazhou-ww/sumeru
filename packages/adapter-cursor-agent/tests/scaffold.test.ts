import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { parseStreamJson } from "../src/stream-parser.js";

describe("@sumeru/adapter-cursor-agent — package surface", () => {
	it("exports createCursorAgentAdapter returning AdapterImpl shape", () => {
		const adapter = createCursorAgentAdapter();
		expect(typeof adapter.init).toBe("function");
		expect(typeof adapter.handle).toBe("function");
		expect(typeof adapter.getNativeId).toBe("function");
	});

	it("getNativeId is null before init/handle", () => {
		const adapter = createCursorAgentAdapter();
		expect(adapter.getNativeId?.() ?? null).toBeNull();
	});

	it("parseStreamJson is exported from the package barrel", () => {
		expect(typeof parseStreamJson).toBe("function");
	});

	it("factory returns independent instances", () => {
		const a = createCursorAgentAdapter();
		const b = createCursorAgentAdapter();
		expect(a).not.toBe(b);
	});
});
