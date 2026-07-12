import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSarsapaAdapter } from "../src/agent.js";
import { createSessionStore } from "../src/session-store.js";

describe("sarsapa session-store", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes init line on init and restores conversation on resume", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sarsapa-session-"));
		tempDirs.push(dir);
		const sessionPath = join(dir, "session.jsonl");
		const adapter = createSarsapaAdapter({ sessionPath });

		await adapter.init({
			instructions: "you are helpful",
			skills: [{ name: "demo", content: "skill body" }],
			model: {
				provider: "openai",
				name: "gpt-4.1",
				apiKey: "test-key",
				contextWindow: 8000,
			},
		});

		const store = createSessionStore(sessionPath);
		const stored = store.load();
		expect(stored?.system).toContain("you are helpful");
		expect(stored?.system).toContain("Skill: demo");
		expect(stored?.model.name).toBe("gpt-4.1");
		expect(stored?.turns).toEqual([]);

		store.appendMessage({
			role: "user",
			content: "hello",
			toolCalls: null,
			toolCallId: null,
		});

		const resumed = createSarsapaAdapter({ sessionPath });
		expect(resumed.resume?.()).toBe(true);

		const lines = readFileSync(sessionPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
			type: "init",
			system: stored?.system,
		});
		expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({
			role: "user",
			content: "hello",
		});
	});
});
