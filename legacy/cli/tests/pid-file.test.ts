/**
 * Unit tests for the PID file module (issue #33).
 *
 * Covers:
 *   - roundtrip writePidFile / readPidFile / removePidFile
 *   - directory + file permissions
 *   - stale pid detection via process.kill(pid, 0) → ESRCH
 *   - liveness check returning true for current pid
 *   - permission errors degrade to warnings, not throws
 *
 * See specs/cli-pid-file.md.
 */

import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	isProcessAlive,
	readPidFile,
	removePidFile,
	writePidFile,
} from "../src/pid-file.js";

function tmpPidPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "sumeru-pid-"));
	return join(dir, "sub", "sumeru.pid");
}

describe("pid-file module (issue #33)", () => {
	const created: string[] = [];

	afterEach(() => {
		for (const path of created) {
			try {
				removePidFile(path);
			} catch {
				/* ignore */
			}
		}
		created.length = 0;
	});

	it("writes the current pid as decimal ASCII followed by newline", () => {
		const path = tmpPidPath();
		created.push(path);
		writePidFile(path, 4242);
		const stat = statSync(path);
		// 0o600 — owner read/write only
		expect(stat.mode & 0o777).toBe(0o600);
		expect(readPidFile(path)).toBe(4242);
	});

	it("creates the parent directory with 0o700 if missing", () => {
		const path = tmpPidPath();
		created.push(path);
		writePidFile(path, process.pid);
		const dirStat = statSync(join(path, ".."));
		expect(dirStat.mode & 0o777).toBe(0o700);
	});

	it("readPidFile returns null for a non-existent file", () => {
		const path = tmpPidPath();
		expect(readPidFile(path)).toBe(null);
	});

	it("readPidFile returns null for a malformed file", () => {
		const path = tmpPidPath();
		created.push(path);
		writePidFile(path, 1);
		writeFileSync(path, "not-a-number\n", { mode: 0o600 });
		expect(readPidFile(path)).toBe(null);
	});

	it("removePidFile is a no-op when the file does not exist", () => {
		const path = tmpPidPath();
		expect(() => removePidFile(path)).not.toThrow();
		expect(existsSync(path)).toBe(false);
	});

	it("isProcessAlive returns true for the current pid", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("isProcessAlive returns false for a clearly dead pid (ESRCH)", () => {
		// Use a very high pid that cannot exist; on Linux pid_max is typically
		// 4_194_303, so 99_999_999 is guaranteed-dead.
		expect(isProcessAlive(99_999_999)).toBe(false);
	});

	it("writePidFile throws on a clearly invalid path so callers can catch and degrade", () => {
		// /proc/sys/kernel is not writable by an unprivileged user; we expect
		// writePidFile to throw rather than swallow — the caller (cli.ts) is
		// responsible for the warn-and-continue semantics.
		const path = "/proc/sys/kernel/sumeru-test-readonly.pid";
		expect(() => writePidFile(path, process.pid)).toThrow();
	});

	it("roundtrip: write → read → remove leaves the path absent", () => {
		const path = tmpPidPath();
		created.push(path);
		writePidFile(path, 12345);
		expect(readPidFile(path)).toBe(12345);
		removePidFile(path);
		expect(existsSync(path)).toBe(false);
		expect(readPidFile(path)).toBe(null);
	});
});
