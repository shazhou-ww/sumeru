import { spawn } from "node:child_process";
import type { SpawnArgs, SpawnFn, SpawnResult } from "./types.js";

const FORCE_KILL_GRACE_MS = 5_000;

export const defaultSpawn: SpawnFn = async ({
	command,
	args,
	stdin,
	timeoutMs,
	cwd,
}: SpawnArgs): Promise<SpawnResult> => {
	const startedAt = Date.now();
	return new Promise<SpawnResult>((resolve, reject) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				stdio: ["pipe", "pipe", "pipe"],
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

		if (child.stdin !== null) {
			child.stdin.end(stdin);
		}
	});
};
