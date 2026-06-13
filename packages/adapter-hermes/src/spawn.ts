/**
 * Default `SpawnFn` — wraps `node:child_process.spawn` with a timeout.
 *
 * Returns `{stdout, stderr, exitCode, signal, timedOut, durationMs}`. On
 * timeout the child receives `SIGTERM`; if it is still alive after 5 s a
 * `SIGKILL` follows. `timedOut` is set to `true`.
 *
 * Argv is passed as an explicit array — never via shell — so embedded
 * quotes, backslashes, newlines, and emoji round-trip without corruption.
 */

import { spawn } from "node:child_process";
import type { SpawnArgs, SpawnFn, SpawnResult } from "./types.js";

const FORCE_KILL_GRACE_MS = 5_000;

export const defaultSpawn: SpawnFn = async ({
	command,
	args,
	timeoutMs,
}: SpawnArgs): Promise<SpawnResult> => {
	const startedAt = Date.now();
	return new Promise<SpawnResult>((resolve, reject) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
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
