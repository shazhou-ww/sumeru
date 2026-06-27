/**
 * PID file management for `sumeru start` (issue #33).
 *
 * Best-effort pid file at `~/.sumeru/sumeru.pid` (or `$SUMERU_PID_FILE`).
 *
 * - `writePidFile(path, pid)` — creates parent dir with 0o700 if missing,
 *   writes `<pid>\n` with mode 0o600. Throws on filesystem errors so the
 *   caller can choose to degrade.
 * - `readPidFile(path)` — returns the parsed pid, `null` if the file is
 *   missing OR malformed (operators may have hand-edited it; we won't crash).
 * - `removePidFile(path)` — silently succeeds if the file is already gone.
 * - `isProcessAlive(pid)` — uses `process.kill(pid, 0)` (no signal sent) to
 *   probe liveness. ESRCH → dead. EPERM → live but foreign (still treated
 *   as live for safety — we don't want to overwrite someone else's pid file).
 *
 * See specs/cli-pid-file.md.
 */

import {
	chmodSync,
	mkdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Resolve the configured pid file path. Honors `SUMERU_PID_FILE` for tests;
 * defaults to `~/.sumeru/sumeru.pid`. `~/` is expanded against `os.homedir()`.
 */
export function resolvePidFilePath(): string {
	const env = process.env.SUMERU_PID_FILE;
	const raw =
		typeof env === "string" && env.length > 0
			? env
			: join(homedir(), ".sumeru", "sumeru.pid");
	const expanded = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return resolve(expanded);
}

/**
 * Write `<pid>\n` to `path` with mode 0o600. Creates the parent dir
 * (0o700) if missing. Throws on EACCES / EROFS / ENOSPC etc. — the caller
 * is responsible for catching and degrading to a warning.
 */
export function writePidFile(path: string, pid: number): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	// `recursive: true` does not chmod an already-existing dir; nudge it.
	try {
		chmodSync(dir, 0o700);
	} catch {
		/* best effort — operator may not own the dir */
	}
	writeFileSync(path, `${pid}\n`, { mode: 0o600 });
	// `writeFileSync` honors mode only on create; force it for overwrite.
	try {
		chmodSync(path, 0o600);
	} catch {
		/* best effort */
	}
}

/**
 * Read and parse the pid file. Returns `null` if the file is missing or
 * the contents are not a positive integer.
 */
export function readPidFile(path: string): number | null {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (err) {
		if (
			err !== null &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code: unknown }).code === "ENOENT"
		) {
			return null;
		}
		throw err;
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	if (!/^\d+$/.test(trimmed)) return null;
	const pid = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(pid) || pid <= 0) return null;
	return pid;
}

/**
 * Remove the pid file. No-op if already absent. Other I/O errors propagate
 * so the caller can decide whether to log.
 */
export function removePidFile(path: string): void {
	try {
		statSync(path);
	} catch (err) {
		if (
			err !== null &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code: unknown }).code === "ENOENT"
		) {
			return;
		}
		throw err;
	}
	try {
		unlinkSync(path);
	} catch (err) {
		if (
			err !== null &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code: unknown }).code === "ENOENT"
		) {
			return;
		}
		throw err;
	}
}

/**
 * Probe whether `pid` is running. Sends signal 0 via `process.kill`, which
 * performs the permission/existence check without actually delivering a
 * signal.
 *
 * - Success → process exists and we can signal it → `true`.
 * - `ESRCH` → no such process → `false`.
 * - `EPERM` → process exists but belongs to another user → `true` (treat
 *   as live; we don't want to overwrite a foreign pid file).
 * - Any other error → `false` (defensive; surfaces as "stale" to the caller).
 */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if (err === null || typeof err !== "object" || !("code" in err)) {
			return false;
		}
		const code = (err as { code: unknown }).code;
		if (code === "EPERM") return true;
		return false;
	}
}
