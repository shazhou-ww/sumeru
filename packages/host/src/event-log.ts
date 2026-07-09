import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";

export type EventLogEntry = {
	event: string;
	data: string;
};

export type EventLog = {
	append(event: string, data: string): void;
	readAll(): Array<EventLogEntry>;
	remove(): void;
};

type EventLogLine = {
	event: string;
	data: string;
	timestamp: string;
};

export function createEventLog(logDir: string, sessionId: string): EventLog {
	const filePath = join(logDir, `${sessionId}.jsonl`);
	let dirEnsured = false;

	function ensureLogDir(): void {
		if (!dirEnsured) {
			mkdirSync(logDir, { recursive: true });
			dirEnsured = true;
		}
	}

	function append(event: string, data: string): void {
		ensureLogDir();
		const line: EventLogLine = {
			event,
			data,
			timestamp: new Date().toISOString(),
		};
		appendFileSync(filePath, `${JSON.stringify(line)}\n`, "utf-8");
	}

	function readAll(): Array<EventLogEntry> {
		if (!existsSync(filePath)) {
			return [];
		}
		const content = readFileSync(filePath, "utf-8");
		if (content.trim().length === 0) {
			return [];
		}
		const entries: Array<EventLogEntry> = [];
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) {
				continue;
			}
			const parsed = JSON.parse(trimmed) as EventLogLine;
			entries.push({ event: parsed.event, data: parsed.data });
		}
		return entries;
	}

	function remove(): void {
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	}

	return { append, readAll, remove };
}
