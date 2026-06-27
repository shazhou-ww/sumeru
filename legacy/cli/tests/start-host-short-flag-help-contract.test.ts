/**
 * Regression test for issue #116 — `-h` = help, host stays long-form only.
 *
 * Pre-fix, START_HELP advertised `-h, --host <host>`, a doubly-broken promise:
 *   1. `-h` right after `start` is swallowed by the per-command help guard
 *      (prints help, never binds a host), and
 *   2. no flag named `h` is registered, so cli-kit would throw
 *      `Unknown option: --h` anyway.
 * The fix makes the help text honest (`-h` = help, per universal CLI
 * convention) and leaves host as `--host` long-form only.
 *
 * Spawns the BUILT cli.js (start-emit-assets.test.ts pattern).
 * See specs/cli/start-host-short-flag-help-contract.md.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function tmpPidFile(): string {
	return join(mkdtempSync(join(tmpdir(), "sumeru-cli-pid-")), "sumeru.pid");
}

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-cli-ocas-"));
}

type RunResult = { code: number | null; stdout: string; stderr: string };

/** Run the CLI to completion, capturing stdout/stderr/exit (for help cases). */
function runCli(
	args: string[],
	env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
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
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});
}

/**
 * Spawn `sumeru start …`, resolve once `Listening on host:port` is printed,
 * returning the host string and port the server actually bound.
 */
function startCliCapture(
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<{
	child: ReturnType<typeof spawn>;
	host: string;
	port: number;
	stderr: string;
}> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI_PATH, "start", ...args], {
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			reject(
				new Error(
					`CLI did not print listening line\nstdout=${stdout}\nstderr=${stderr}`,
				),
			);
		}, 8_000);
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
			const m = stdout.match(/Listening on http:\/\/([^:]+):(\d+)/);
			if (m !== null) {
				clearTimeout(timeout);
				resolve({
					child,
					host: m[1] ?? "",
					port: Number.parseInt(m[2] ?? "0", 10),
					stderr,
				});
			}
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});
		child.once("exit", () => {
			clearTimeout(timeout);
			reject(
				new Error(
					`CLI exited before listening\nstdout=${stdout}\nstderr=${stderr}`,
				),
			);
		});
	});
}

describe("sumeru start — `-h` is help, not host (issue #116)", () => {
	it("Then-1: `sumeru start -h` prints start help, exits 0, does not bind", async () => {
		const { code, stdout, stderr } = await runCli(["start", "-h"]);
		expect(code).toBe(0);
		expect(stdout).toContain("Usage: sumeru start [options]");
		expect(stdout).not.toContain("Listening on");
		expect(stdout).not.toContain("Unknown option");
		expect(stderr).not.toContain("Unknown option");
	}, 10_000);

	it("Then-2: top-level `sumeru -h` prints top-level help, exits 0", async () => {
		const { code, stdout } = await runCli(["-h"]);
		expect(code).toBe(0);
		expect(stdout).toContain("Usage: sumeru <command> [options]");
		// Top-level help correctly advertises -h, --help.
		expect(stdout).toMatch(/-h, --help/);
	}, 10_000);

	it("Then-4: START_HELP lists host as long form only — no `-h, --host` lie, and every advertised short flag is real", async () => {
		const { stdout } = await runCli(["start", "--help"]);
		// The host line must NOT advertise a -h short alias.
		expect(stdout).not.toMatch(/-h,\s*--host/);
		// Host is still documented (long form).
		expect(stdout).toMatch(/--host <host>/);
		// Every short flag START_HELP advertises actually works post-fix:
		// -p → port (restored), -c → config (already worked). There is no
		// entry promising a short flag the parser would reject.
		expect(stdout).toMatch(/-p, --port/);
		expect(stdout).toMatch(/-c, --config/);
		// `-h` = help (universal convention) is documented in the top-level
		// HELP_TEXT, asserted in Then-2 — START_HELP intentionally lists only
		// start-specific options, so it must NOT re-promise a host `-h`.
	}, 10_000);

	it("Then-3: long `--host` binds the given address (untouched by this fix)", async () => {
		const ocas = tmpOcasDir();
		const { child, host, stderr } = await startCliCapture(
			["--host", "127.0.0.1", "-p", "0", "--ocas-dir", ocas],
			{ SUMERU_PID_FILE: tmpPidFile() },
		);
		try {
			expect(host).toBe("127.0.0.1");
			expect(stderr).not.toContain("Unknown option");
		} finally {
			child.kill("SIGTERM");
			await new Promise<void>((resolve) => child.once("exit", () => resolve()));
		}
	}, 15_000);
});
