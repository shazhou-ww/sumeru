import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";

function writeV3HostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			"maxRunning: 3",
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
			"models:",
			"  anthropic:",
			"    baseUrl: null",
			"    apiKey: sk-test",
			"  openai: null",
			"  openrouter: null",
		].join("\n"),
	);
}

describe("loadHostConfig — v3 HostConfig", () => {
	it("loads host.yaml and scans dataDir prototypes/skills", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-config-"));
		writeV3HostFixture(rootDir);
		const dataDir = join(rootDir, "data");
		mkdirSync(join(dataDir, "skills"), { recursive: true });
		mkdirSync(join(dataDir, "prototypes"), { recursive: true });
		writeFileSync(join(dataDir, "skills", "demo.md"), "# Demo skill\n");
		writeFileSync(
			join(dataDir, "prototypes", "worker.yaml"),
			[
				"name: worker",
				"instructions: You are a worker.",
				"skills:",
				"  - demo",
			].join("\n"),
		);

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.config.name).toBe("test-host");
		expect(loaded.config.maxRunning).toBe(3);
		expect(loaded.config.workspaceRoot).toBe("/tmp/workspaces");
		expect(loaded.skillsDir).toBe(join(dataDir, "skills"));
		expect(loaded.prototypesDir).toBe(join(dataDir, "prototypes"));

		const prototype = loaded.prototypes.get("worker");
		expect(prototype?.prototype.instructions).toBe("You are a worker.");
		expect(prototype?.prototype.skills).toEqual(["demo"]);
		expect(prototype?.prototypeHash).toMatch(/^[a-f0-9]{64}$/);
	});
});
