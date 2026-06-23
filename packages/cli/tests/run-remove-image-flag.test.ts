/**
 * Test for the legacy `-i, --image` flag removal on `sumeru run`
 * (issue #85, phase 2, deliverable 4).
 *
 * `deploy.image` in the config is the single source of truth for the Docker
 * image; the stray per-invocation `-i, --image` flag is a second source and is
 * deleted. Asserts specs/cli/run-remove-legacy-image-flag.md:
 *   - `sumeru run --help` lists none of `-i` / `--image` / "Docker image",
 *   - passing `-i` is rejected as an unknown option,
 *   - the other run options + the start command are untouched.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

type RunResult = { code: number | null; stdout: string; stderr: string };

function runCli(args: string[]): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI_PATH, ...args], {
			env: { ...process.env },
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

describe("sumeru run — legacy --image flag removed (issue #85)", () => {
	it("`run --help` lists no -i / --image / Docker image entry", async () => {
		const res = await runCli(["run", "--help"]);
		expect(res.code).toBe(0);
		expect(res.stdout).not.toMatch(/--image/);
		expect(res.stdout).not.toMatch(/\bDocker image\b/);
		expect(res.stdout).not.toMatch(/-i,/);
		// The remaining options are still present.
		expect(res.stdout).toMatch(/--scene/);
		expect(res.stdout).toMatch(/--runner/);
		expect(res.stdout).toMatch(/--model/);
		expect(res.stdout).toMatch(/--timeout/);
		expect(res.stdout).toMatch(/--no-network/);
		expect(res.stdout).toMatch(/--output/);
	}, 20_000);

	it("passing the removed -i flag is rejected as an unknown option", async () => {
		const res = await runCli([
			"run",
			"-i",
			"sumeru:latest",
			"-s",
			"./scene",
			"-r",
			"hermes",
			"-m",
			"foo",
		]);
		expect(res.code).not.toBe(0);
		expect(res.stderr).toMatch(/unknown option/i);
	}, 20_000);

	it("`start --help` is untouched and lists --emit-assets alongside the existing flags", async () => {
		const res = await runCli(["start", "--help"]);
		expect(res.code).toBe(0);
		expect(res.stdout).toMatch(/--port/);
		expect(res.stdout).toMatch(/--host/);
		expect(res.stdout).toMatch(/--config/);
		expect(res.stdout).toMatch(/--ocas-dir/);
		expect(res.stdout).toMatch(/--force/);
		expect(res.stdout).toMatch(/--emit-assets/);
	}, 20_000);
});
