import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Host-wide structured logger.
 * Writes JSONL to ~/.sumeru/logs/YYYY-MM-DD.jsonl.
 *
 * Tags are 8-char Crockford Base32 subsystem identifiers:
 *   SMRHST00 — host server lifecycle (start, stop, signals)
 *   SMRCFG00 — config loading / deprecation warnings
 *   SMRSES00 — session management
 *   SMRGRP00 — process guards (unhandled rejections)
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function write(level: LogLevel, tag: string, msg: string): void {
	const day = new Date().toISOString().slice(0, 10);
	const dir = join(homedir(), ".sumeru", "logs");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${day}.jsonl`);
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		pid: process.pid,
		level,
		tag,
		msg,
	});
	appendFileSync(file, `${line}\n`, "utf-8");
}

export const logger = {
	debug: (tag: string, msg: string): void => write("debug", tag, msg),
	info: (tag: string, msg: string): void => write("info", tag, msg),
	warn: (tag: string, msg: string): void => write("warn", tag, msg),
	error: (tag: string, msg: string): void => write("error", tag, msg),
};

// Subsystem tags
export const TAG_HOST = "SMRHST00";
export const TAG_CFG = "SMRCFG00";
export const TAG_SESSION = "SMRSES00";
export const TAG_GUARD = "SMRGRP00";
