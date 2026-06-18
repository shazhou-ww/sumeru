/**
 * Default `SpawnFn` for the Cursor Agent adapter — wraps
 * `node:child_process.spawn` with a timeout.
 *
 * Returns `{stdout, stderr, exitCode, signal, timedOut, durationMs}`. On
 * timeout the child receives `SIGTERM`; if it is still alive after 5 s a
 * `SIGKILL` follows. `timedOut` is set to `true`.
 *
 * Argv is passed as an explicit array — never via shell — so embedded
 * quotes, backslashes, newlines, and emoji round-trip without corruption.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
	SpawnArgs,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
} from "./types.js";

const FORCE_KILL_GRACE_MS = 5_000;

export const defaultSpawn: SpawnFn = async ({
	command,
	args,
	timeoutMs,
	cwd,
}: SpawnArgs): Promise<SpawnResult> => {
	const startedAt = Date.now();
	return new Promise<SpawnResult>((resolve, reject) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				cwd,
				env: process.env,
				shell: false,
			});
		} catch (err) {
			reject(err instanceof Error ? err : new Error(String(err)));
			return;
		}

		let timedOut = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					child.kill("SIGKILL");
				}
			}, FORCE_KILL_GRACE_MS).unref();
		}, timeoutMs);
		timer.unref();

		child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

		child.once("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
				stderr: Buffer.concat(stderrChunks).toString("utf-8"),
				exitCode: code,
				signal: signal ?? null,
				timedOut,
				durationMs: Date.now() - startedAt,
			});
		});
	});
};

/**
 * Streaming variant of `defaultSpawn` — returns synchronously with
 * line-by-line stdout access via `lines` (an AsyncIterable<string>).
 */
export const defaultStreamingSpawn: StreamingSpawnFn = ({
	command,
	args,
	timeoutMs,
	cwd,
}: SpawnArgs): SpawnStreamResult => {
	const startedAt = Date.now();
	const child = spawn(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		cwd,
		env: process.env,
		shell: false,
	});

	let timedOut = false;
	const stderrChunks: Buffer[] = [];

	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
		setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		}, FORCE_KILL_GRACE_MS).unref();
	}, timeoutMs);
	timer.unref();

	// stdio: ["ignore", "pipe", "pipe"] guarantees child.stdout is non-null
	const stdout = child.stdout;
	if (stdout === null) {
		throw new Error("child.stdout is null despite pipe stdio configuration");
	}

	child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

	const rl = createInterface({ input: stdout, crlfDelay: Infinity });

	const exitPromise = new Promise<SpawnExitInfo>((resolve, reject) => {
		child.once("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({
				exitCode: code,
				signal: signal ?? null,
				timedOut,
				durationMs: Date.now() - startedAt,
				stderr: Buffer.concat(stderrChunks).toString("utf-8"),
			});
		});
	});

	return {
		lines: rl,
		waitForExit: () => exitPromise,
	};
};
