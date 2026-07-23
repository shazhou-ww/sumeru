/**
 * Streaming spawn helper for the Claude Code adapter.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
	SpawnArgs,
	SpawnExitInfo,
	SpawnStreamResult,
	StreamingSpawnFn,
} from "./types.js";

const FORCE_KILL_GRACE_MS = 5_000;

export const defaultStreamingSpawn: StreamingSpawnFn = ({
	command,
	args,
	timeoutMs,
	cwd,
	env,
}: SpawnArgs): SpawnStreamResult => {
	const startedAt = Date.now();
	const child = spawn(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		cwd,
		env: env ?? process.env,
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
