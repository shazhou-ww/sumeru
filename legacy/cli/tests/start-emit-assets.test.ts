/**
 * End-to-end test for `--emit-assets` (issue #85, phase 2).
 *
 * Spawns the BUILT CLI and asserts the materialize-and-exit contract from
 * specs/cli/start-emit-assets.md:
 *   - the three packaged templates land next to the config, byte-identical to
 *     their source under packages/server/templates/docker/,
 *   - exit 0, written paths printed, NO Docker probe / port bind / server,
 *   - explicit overwrite (refresh) of a hand-edited file,
 *   - `--emit-assets` without `-c` is a clean exit-1 usage error.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const TEMPLATE_SRC = fileURLToPath(
	new URL("../../server/templates/docker/", import.meta.url),
);
const TEMPLATE_NAMES = [
	"Dockerfile",
	"docker-compose.yaml",
	"sumeru.env.example",
];

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
			env: { ...process.env, ...env },
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

function unitWithConfig(): { dir: string; configPath: string } {
	const dir = tmpDir("sumeru-emit-");
	const configPath = join(dir, "sumeru.yaml");
	writeFileSync(configPath, "name: alpha\n", "utf-8");
	return { dir, configPath };
}

describe("sumeru start --emit-assets (issue #85)", () => {
	it("materializes the three templates byte-identically and exits 0", async () => {
		const { dir, configPath } = unitWithConfig();
		const pidPath = join(tmpDir("sumeru-pid-"), "sumeru.pid");
		const res = await runCli(["start", "-c", configPath, "--emit-assets"], {
			SUMERU_PID_FILE: pidPath,
		});

		expect(res.code).toBe(0);
		for (const name of TEMPLATE_NAMES) {
			const dest = join(dir, name);
			expect(existsSync(dest)).toBe(true);
			expect(readFileSync(dest)).toEqual(
				readFileSync(join(TEMPLATE_SRC, name)),
			);
		}
		// Printed the written paths.
		expect(res.stdout).toContain("docker-compose.yaml");
		// Did NOT take any launch path.
		expect(res.stdout).not.toMatch(/Listening on/);
		expect(existsSync(pidPath)).toBe(false);
	}, 20_000);

	it("explicit emit overwrites a hand-edited compose file (refresh)", async () => {
		const { dir, configPath } = unitWithConfig();
		const composePath = join(dir, "docker-compose.yaml");
		writeFileSync(composePath, "# STALE hand edit\n", "utf-8");

		const res = await runCli(["start", "-c", configPath, "--emit-assets"], {
			SUMERU_PID_FILE: join(tmpDir("sumeru-pid-"), "sumeru.pid"),
		});

		expect(res.code).toBe(0);
		// Overwritten back to the packaged bytes (contrast with auto-start).
		expect(readFileSync(composePath)).toEqual(
			readFileSync(join(TEMPLATE_SRC, "docker-compose.yaml")),
		);
	}, 20_000);

	it("--emit-assets without -c is a clean exit-1 usage error (no stack trace)", async () => {
		const res = await runCli(["start", "--emit-assets"], {
			SUMERU_PID_FILE: join(tmpDir("sumeru-pid-"), "sumeru.pid"),
		});
		expect(res.code).toBe(1);
		expect(res.stderr).toMatch(/--emit-assets requires -c/);
		expect(res.stderr).not.toMatch(/\n\s+at /);
	}, 20_000);
});
