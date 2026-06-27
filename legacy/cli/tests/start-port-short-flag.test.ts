/**
 * Regression test for issue #116 — `sumeru start -p <port>` short flag.
 *
 * Pre-fix, cli.ts registered only `-c` (config) as a short alias; `-p` was
 * never registered, so cli-kit threw `Unknown option: --p` (the `--` is always
 * prepended in cli-kit's error text). This test spawns the BUILT cli.js and
 * proves:
 *   - `-p <P>` binds the EXACT free port P (not the 7900 default) — the
 *     load-bearing assertion that the alias is resolved BEFORE the port
 *     default is applied (a naive `flags.port ?? flags.p` would bind 7900),
 *   - `-p 0` binds a real ephemeral port,
 *   - long `--port` is unchanged,
 *   - explicit `--port` + `-p` together resolve deterministically (long wins,
 *     same precedence as config/c) — not an `Unknown option` error,
 *   - the process exits 0 on SIGTERM and frees the port.
 *
 * Mirrors the spawn-the-built-dist pattern of start-graceful-shutdown.test.ts.
 * See specs/cli/start-port-short-flag.md.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

type SpawnedCli = {
	pid: number;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
};

function tmpPidFile(): string {
	return join(mkdtempSync(join(tmpdir(), "sumeru-cli-pid-")), "sumeru.pid");
}

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-cli-ocas-"));
}

/** Source a known-free TCP port deterministically: listen on :0, read it, close. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const addr = probe.address() as AddressInfo;
			const port = addr.port;
			probe.close(() => resolve(port));
		});
	});
}

/**
 * Spawn the built CLI's `start` command and resolve once the `Listening on …`
 * line appears, returning the bound port the server actually printed.
 */
async function startCli(
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<{
	child: ReturnType<typeof spawn>;
	boundPort: number;
	captured: SpawnedCli;
}> {
	const captured: SpawnedCli = {
		pid: 0,
		stdout: "",
		stderr: "",
		exitCode: null,
		signal: null,
	};
	const child = spawn(process.execPath, [CLI_PATH, "start", ...args], {
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	captured.pid = child.pid ?? 0;
	child.stdout?.on("data", (chunk: Buffer) => {
		captured.stdout += chunk.toString("utf-8");
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		captured.stderr += chunk.toString("utf-8");
	});

	const boundPort = await new Promise<number>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new Error(
					`CLI did not print listening line\nstdout=${captured.stdout}\nstderr=${captured.stderr}`,
				),
			);
		}, 8_000);
		const check = (): void => {
			const m = captured.stdout.match(/Listening on http:\/\/[^:]+:(\d+)/);
			if (m !== null) {
				clearTimeout(timeout);
				resolve(Number.parseInt(m[1] ?? "0", 10));
			}
		};
		child.stdout?.on("data", check);
		child.on("exit", () => {
			clearTimeout(timeout);
			reject(
				new Error(
					`CLI exited before listening\ncode=${child.exitCode}\nstdout=${captured.stdout}\nstderr=${captured.stderr}`,
				),
			);
		});
	});

	return { child, boundPort, captured };
}

function waitForExit(
	child: ReturnType<typeof spawn>,
	captured: SpawnedCli,
	timeoutMs = 4_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			reject(new Error("CLI did not exit within timeout"));
		}, timeoutMs);
		child.once("exit", (code, signal) => {
			clearTimeout(t);
			captured.exitCode = code;
			captured.signal = signal;
			resolve();
		});
	});
}

function isPortFree(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, host, () => {
			probe.close(() => resolve(true));
		});
	});
}

/** Run the CLI to completion (used for the parse-error / no-listen cases). */
function runCli(
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI_PATH, "start", ...args], {
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

describe("sumeru start — `-p` short flag for port (issue #116)", () => {
	let cleanup: (() => Promise<void>) | null = null;

	beforeEach(() => {
		cleanup = null;
	});

	afterEach(async () => {
		if (cleanup !== null) {
			await cleanup().catch(() => undefined);
			cleanup = null;
		}
	});

	it("When-1: `-p <P>` is accepted and binds EXACTLY P (not the 7900 default)", async () => {
		const P = await freePort();
		const pidPath = tmpPidFile();
		const ocas = tmpOcasDir();
		const { child, boundPort, captured } = await startCli(
			["-p", String(P), "--ocas-dir", ocas],
			{ SUMERU_PID_FILE: pidPath },
		);
		cleanup = async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		};
		// Load-bearing: the bound port is the explicit P, NOT 7900. This is what
		// distinguishes the correct fix from `flags.port ?? flags.p` (default
		// shadows the alias → would bind 7900).
		expect(boundPort).toBe(P);
		expect(captured.stdout).toMatch(
			new RegExp(`^Listening on http://127\\.0\\.0\\.1:${P}$`, "m"),
		);
		// No parse error leaked — neither the raw string nor the rendered envelope.
		expect(captured.stdout).not.toContain("Unknown option");
		expect(captured.stderr).not.toContain("Unknown option");
		expect(existsSync(pidPath)).toBe(true);

		child.kill("SIGTERM");
		await waitForExit(child, captured);
		expect(captured.exitCode === 0 || captured.signal === "SIGTERM").toBe(true);
		if (captured.exitCode === 0) {
			expect(existsSync(pidPath)).toBe(false);
			expect(await isPortFree("127.0.0.1", P)).toBe(true);
		}
	}, 15_000);

	it("When-2: `-p 0` yields an OS-chosen ephemeral (non-zero) port", async () => {
		const pidPath = tmpPidFile();
		const ocas = tmpOcasDir();
		const { child, boundPort, captured } = await startCli(
			["-p", "0", "--ocas-dir", ocas],
			{ SUMERU_PID_FILE: pidPath },
		);
		cleanup = async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		};
		expect(boundPort).toBeGreaterThan(0);
		expect(captured.stderr).not.toContain("Unknown option");
		child.kill("SIGTERM");
		await waitForExit(child, captured);
	}, 15_000);

	it("When-3: long `--port <P>` still binds P (no regression)", async () => {
		const P = await freePort();
		const pidPath = tmpPidFile();
		const ocas = tmpOcasDir();
		const { child, boundPort, captured } = await startCli(
			["--port", String(P), "--ocas-dir", ocas],
			{ SUMERU_PID_FILE: pidPath },
		);
		cleanup = async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		};
		expect(boundPort).toBe(P);
		child.kill("SIGTERM");
		await waitForExit(child, captured);
	}, 15_000);

	it("When-4: both `--port P` and `-p Q` resolve deterministically (long `--port` wins, no Unknown option)", async () => {
		const P = await freePort();
		const Q = await freePort();
		// Guard the fixture: P and Q must differ for the precedence assertion to mean something.
		expect(P).not.toBe(Q);
		const pidPath = tmpPidFile();
		const ocas = tmpOcasDir();
		const { child, boundPort, captured } = await startCli(
			["--port", String(P), "-p", String(Q), "--ocas-dir", ocas],
			{ SUMERU_PID_FILE: pidPath },
		);
		cleanup = async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		};
		// Fixed precedence: long `--port` wins over short `-p`, mirroring
		// `flags.config ?? flags.c`. Supplying both is NOT undefined behavior
		// and NOT an Unknown option error.
		expect(boundPort).toBe(P);
		expect(captured.stdout).not.toContain("Unknown option");
		expect(captured.stderr).not.toContain("Unknown option");
		child.kill("SIGTERM");
		await waitForExit(child, captured);
	}, 15_000);

	it("regression sentinel: `-p` does NOT surface as `Unknown option: --p`", async () => {
		// Spawn with an immediately-bad config so the process exits fast without
		// holding a port, but AFTER flag parsing — proving `-p` parses cleanly.
		const ocas = tmpOcasDir();
		const { code, stdout, stderr } = await runCli(
			["-p", "0", "--config", "/nonexistent/sumeru.yaml", "--ocas-dir", ocas],
			{ SUMERU_PID_FILE: tmpPidFile() },
		);
		const combined = stdout + stderr;
		expect(combined).not.toContain("Unknown option: --p");
		expect(combined).not.toContain("Unknown option");
		// It failed for the config reason, not a parse error.
		expect(code).toBe(1);
		expect(stderr).toContain("Failed to load config");
	}, 15_000);
});
