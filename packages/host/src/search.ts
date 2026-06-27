import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InstanceId, TurnValue } from "@sumeru/core";
import type { TurnRecord } from "./ocas-recorder.js";

export type SearchHit = {
	instanceId: InstanceId;
	turn: TurnRecord;
	highlight: string;
};

export type SearchIndex = {
	search(query: string, instanceFilter: InstanceId | null): Array<SearchHit>;
};

const HIGHLIGHT_RADIUS = 40;

export function createSearchIndex(dataDir: string): SearchIndex {
	const entries = loadTurnEntries(dataDir);

	function search(
		query: string,
		instanceFilter: InstanceId | null,
	): Array<SearchHit> {
		const trimmed = query.trim();
		if (trimmed.length === 0) return [];

		const lowerQuery = trimmed.toLowerCase();
		const hits: Array<SearchHit> = [];

		for (const entry of entries) {
			if (instanceFilter !== null && entry.instanceId !== instanceFilter) {
				continue;
			}
			const content = entry.turn.value.content;
			const matchIndex = content.toLowerCase().indexOf(lowerQuery);
			if (matchIndex === -1) continue;
			hits.push({
				instanceId: entry.instanceId,
				turn: entry.turn,
				highlight: buildHighlight(content, matchIndex, trimmed.length),
			});
		}

		return hits;
	}

	return { search };
}

type TurnEntry = {
	instanceId: InstanceId;
	turn: TurnRecord;
};

function loadTurnEntries(dataDir: string): Array<TurnEntry> {
	let files: Array<string>;
	try {
		files = readdirSync(dataDir).filter((name) => name.endsWith(".jsonl"));
	} catch {
		return [];
	}

	const entries: Array<TurnEntry> = [];
	for (const fileName of files) {
		const instanceId = fileName.slice(0, -".jsonl".length);
		if (instanceId.length === 0) continue;

		let raw = "";
		try {
			raw = readFileSync(join(dataDir, fileName), "utf-8");
		} catch {
			continue;
		}

		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				continue;
			}
			const turn = parseTurnRecord(parsed);
			if (turn !== null) {
				entries.push({ instanceId, turn });
			}
		}
	}

	return entries;
}

function parseTurnRecord(value: unknown): TurnRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const obj = value as Record<string, unknown>;
	const timestamp = obj.timestamp;
	const type = obj.type;
	const eventValue = obj.value;
	if (typeof timestamp !== "string" || timestamp.length === 0) return null;
	if (type !== "turn") return null;
	if (
		eventValue === null ||
		typeof eventValue !== "object" ||
		Array.isArray(eventValue)
	) {
		return null;
	}
	const turnValue = eventValue as TurnValue;
	if (typeof turnValue.content !== "string") return null;
	return {
		timestamp,
		type: "turn",
		value: turnValue,
		hash: null,
	};
}

function buildHighlight(
	content: string,
	matchIndex: number,
	matchLength: number,
): string {
	const start = Math.max(0, matchIndex - HIGHLIGHT_RADIUS);
	const end = Math.min(
		content.length,
		matchIndex + matchLength + HIGHLIGHT_RADIUS,
	);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < content.length ? "…" : "";
	return `${prefix}${content.slice(start, end)}${suffix}`;
}
