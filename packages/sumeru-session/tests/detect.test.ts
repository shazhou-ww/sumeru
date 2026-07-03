import { describe, expect, it } from "vitest";
import { detectAdapter } from "../src/detect.js";

describe("detectAdapter", () => {
	it("prefers codex when codex CLI is available", () => {
		const adapter = detectAdapter((command) => command === "codex");
		expect(adapter).toBe("codex");
	});

	it("detects hermes when only hermes CLI is available", () => {
		const adapter = detectAdapter((command) => command === "hermes");
		expect(adapter).toBe("hermes");
	});

	it("detects claude-code when only claude CLI is available", () => {
		const adapter = detectAdapter((command) => command === "claude");
		expect(adapter).toBe("claude-code");
	});

	it("detects cursor-agent when only cursor-agent CLI is available", () => {
		const adapter = detectAdapter((command) => command === "cursor-agent");
		expect(adapter).toBe("cursor-agent");
	});

	it("falls back to sarsapa when no external CLI is available", () => {
		const adapter = detectAdapter(() => false);
		expect(adapter).toBe("sarsapa");
	});

	it("uses probe priority when multiple CLIs are available", () => {
		const available = new Set(["codex", "hermes", "claude", "cursor-agent"]);
		const adapter = detectAdapter((command) => available.has(command));
		expect(adapter).toBe("codex");
	});
});
