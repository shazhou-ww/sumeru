/**
 * PID file helpers for `sumeru server start/stop`.
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

export function resolvePidFilePath(): string {
	const env = process.env.SUMERU_PID_FILE;
	const raw =
		typeof env === "string" && env.length > 0
			? env
			: join(homedir(), ".sumeru", "sumeru.pid");
	const expanded = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return resolve(expanded);
}

export function writePidFile(path: string, pid: number): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(dir, 0o700);
	} catch {
		/* best effort */
	}
	writeFileSync(path, `${pid}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		/* best effort */
	}
}

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
	if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return null;
	const pid = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(pid) || pid <= 0) return null;
	return pid;
}

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
