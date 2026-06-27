import { mkdtempSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createHermesAdapter } from "../src/adapter.js";
import type { SpawnArgs, SpawnFn } from "../src/types.js";

const INIT_CONFIG: AdapterInitConfig = {
	instructions: "You are the master agent.",
	skills: [{ name: "demo", content: "demo skill body" }],
	model: {
		provider: "anthropic",
		name: "claude-sonnet-4",
		apiKeyEnv: "ANTHROPIC_API_KEY",
		contextWindow: 200_000,
	},
};

describe("@sumeru/adapter-hermes — adapter", () => {
	it("init writes SOUL.md and skills under the configured hermes dir", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-init-"));
		const adapter = createHermesAdapter({ profile: "test", hermesDir });
		await adapter.init(INIT_CONFIG);

		const soul = await readFile(join(hermesDir, "SOUL.md"), "utf-8");
		expect(soul).toBe(INIT_CONFIG.instructions);
		const skill = await readFile(
			join(hermesDir, "skills", "demo", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("demo skill body");
	});

	it("handle spawns hermes with stdin content and yields assistant turns", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-handle-"));
		const sessionsDir = join(hermesDir, "sessions");
		await mkdir(sessionsDir, { recursive: true });
		const nativeId = "20260627_120000_abcd12";
		const spawnCalls: Array<SpawnArgs> = [];
		const spawnFn: SpawnFn = async (args) => {
			spawnCalls.push(args);
			return {
				stdout: "",
				stderr: `session_id: ${nativeId}\n`,
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 12,
			};
		};
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			spawnFn,
			jsonlReader: async () => [
				{
					index: 0,
					role: "assistant",
					content: "hello from hermes",
					timestamp: "2026-06-27T00:00:00.000Z",
					toolCalls: null,
					tokens: null,
				},
			],
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_1",
			content: "ping",
			project: null,
			resumeNativeId: null,
		});
		const turns = [];
		while (true) {
			const step = await generator.next();
			if (step.done === true) {
				expect(step.value.tokenUsage).toBeNull();
				break;
			}
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(spawnCalls).toHaveLength(1);
		expect(spawnCalls[0]?.stdin).toBe("ping");
		expect(spawnCalls[0]?.args).toEqual([
			"chat",
			"-q",
			"ping",
			"--pass-session-id",
			"--quiet",
			"--source",
			"sumeru",
		]);
		expect(turns).toHaveLength(1);
		expect(turns[0]?.content).toBe("hello from hermes");
		expect(adapter.getNativeId?.()).toBe(nativeId);
	});
});
