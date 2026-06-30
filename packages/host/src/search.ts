import type { TurnValue } from "@sumeru/adapter-core";
import { openOcasStore, readChain, type TurnRecord } from "./ocas-recorder.js";

export type SearchHit = {
	sessionId: string;
	turn: TurnRecord;
	highlight: string;
};

export type SearchIndex = {
	search(query: string, sessionFilter: string | null): Array<SearchHit>;
};

const HIGHLIGHT_RADIUS = 40;

export function createSearchIndex(dataDir: string): SearchIndex {
	const entries = loadTurnEntries(dataDir);

	function search(
		query: string,
		sessionFilter: string | null,
	): Array<SearchHit> {
		const trimmed = query.trim();
		if (trimmed.length === 0) return [];

		const lowerQuery = trimmed.toLowerCase();
		const hits: Array<SearchHit> = [];

		for (const entry of entries) {
			if (sessionFilter !== null && entry.sessionId !== sessionFilter) {
				continue;
			}
			const content =
				entry.turn.value.role === "tool"
					? entry.turn.value.result
					: entry.turn.value.content;
			const matchIndex = content.toLowerCase().indexOf(lowerQuery);
			if (matchIndex === -1) continue;
			hits.push({
				sessionId: entry.sessionId,
				turn: entry.turn,
				highlight: buildHighlight(content, matchIndex, trimmed.length),
			});
		}

		return hits;
	}

	return { search };
}

type TurnEntry = {
	sessionId: string;
	turn: TurnRecord;
};

const CHAIN_VAR_PREFIX = "@sumeru/chain/";

/**
 * Load every recorded turn across all sessions by walking each session's
 * CAS chain. Opens the store read-only, drains it eagerly into memory, then
 * closes the SQLite handle so the per-request index does not leak connections.
 */
function loadTurnEntries(dataDir: string): Array<TurnEntry> {
	let handle: ReturnType<typeof openOcasStore>;
	try {
		handle = openOcasStore(dataDir);
	} catch {
		return [];
	}

	const entries: Array<TurnEntry> = [];
	try {
		const heads = handle.store.var.list({ namePrefix: CHAIN_VAR_PREFIX });
		for (const head of heads) {
			const sessionId = head.name.slice(CHAIN_VAR_PREFIX.length);
			if (sessionId.length === 0) continue;
			for (const entry of readChain(handle.store, sessionId)) {
				if (entry.payload.type !== "turn") continue;
				const value = entry.payload.value as TurnValue;
				if (value.role === "tool") continue;
				entries.push({
					sessionId,
					turn: {
						timestamp: entry.payload.timestamp,
						type: "turn",
						value,
						hash: entry.hash,
					},
				});
			}
		}
	} finally {
		handle.close();
	}

	return entries;
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
