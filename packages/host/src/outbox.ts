import type { OutboxFrame } from "@sumeru/adapter-core";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function parseOutboxLine(line: string): OutboxFrame | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
	if (
		parsed.type === "turn" ||
		parsed.type === "done" ||
		parsed.type === "suspend" ||
		parsed.type === "error"
	) {
		return parsed as OutboxFrame;
	}
	return null;
}
