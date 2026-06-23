/**
 * End-to-end test for the no-Docker downgrade (issue #85, phase 2).
 *
 * Asserts specs/cli/start-docker-unavailable.md: a `deploy.mode: docker` config
 * on a Docker-less host exits 1 with exactly one stderr line and no stack
 * trace, no fallback to local, no compose spawn. Forced via
 * `SUMERU_DOCKER_BIN` pointing at a missing path (ENOENT) or a fake that exits
 * non-zero for `info`.
 */

import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const DOWNGRADE =
	"Docker is not available. Install Docker or set deploy.mode: local in your config.";

const dirs: string[] = [];
function tmpDir(prefix: string): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(d);
	return d;
}

afterEach(() => {
	while (dirs.length > 0) {
		const d = dirs.pop();
		if (d !== undefined) rmSync(d, { recursive: true, force: true });
	}
});

type RunResult = { code: number | null; stdout: string; stderr: string };

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI_PATH, ...args], {
			// Reproduce the production shebang's `--disable-warning=Experimental
			// Warning` so stderr carries only the CLI's own output (the spec pins
			// it to exactly one line). The real `./dist/cli.js` shebang does this;
			// spawning via `node dist/cli.js` would otherwise leak Node's SQLite
			// experimental warning onto stderr.
			env: {
				...process.env,
				NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});
		child.on("exit", (code) => resolve({ code, stdout, stderr }));
	});
}

function dockerConfig(): string {
	const dir = tmpDir("sumeru-unit-");
	const configPath = join(dir, "sumeru.yaml");
	writeFileSync(
		configPath,
		[
			"name: alpha",
			"deploy:",
			"  mode: docker",
			"  port: 7901",
			"gateways:",
			"  hermes:",
			"    adapter: hermes",
			"    capabilities: { resume: true, streaming: true }",
			"",
		].join("\n"),
		"utf-8",
	);
	return configPath;
}

// A fake docker that exits non-zero for `info` (daemon down).
const FAILING_DOCKER = ["#!/usr/bin/env node", "process.exit(1);", ""].join(
	"\n",
);

function writeFailingDocker(): string {
	const p = join(tmpDir("sumeru-fakedocker-"), "fake-docker.cjs");
	writeFileSync(p, FAILING_DOCKER, "utf-8");
	chmodSync(p, 0o755);
	return p;
}

describe("sumeru start — no-Docker downgrade (issue #85)", () => {
	function assertDowngrade(res: RunResult): void {
		expect(res.code).toBe(1);
		const lines = res.stderr.split("\n").filter((l) => l.length > 0);
		expect(lines).toEqual([DOWNGRADE]);
		// No stack trace, no [sumeru] prefix, no Failed-to-start wrapper.
		expect(res.stderr).not.toMatch(/\n\s+at /);
		expect(res.stderr).not.toMatch(/\[sumeru\]/);
		expect(res.stderr).not.toMatch(/Failed to start/);
	}

	it("When-1: docker binary missing (ENOENT) → exact line, exit 1", async () => {
		const res = await runCli(["start", "-c", dockerConfig()], {
			SUMERU_DOCKER_BIN: "/nonexistent/path/to/docker",
			SUMERU_PID_FILE: join(tmpDir("sumeru-pid-"), "sumeru.pid"),
		});
		assertDowngrade(res);
	}, 20_000);

	it("When-2: docker present but `docker info` exits non-zero → exact line, exit 1", async () => {
		const res = await runCli(["start", "-c", dockerConfig()], {
			SUMERU_DOCKER_BIN: writeFailingDocker(),
			SUMERU_PID_FILE: join(tmpDir("sumeru-pid-"), "sumeru.pid"),
		});
		assertDowngrade(res);
	}, 20_000);
});
