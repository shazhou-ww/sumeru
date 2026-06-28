import type { InstanceId, TurnValue } from "@sumeru/core";
import { openOcasStore, readChain, type TurnRecord } from "./ocas-recorder.js";

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

const CHAIN_VAR_PREFIX = "@sumeru/chain/";

/**
 * Load every recorded turn across all instances by walking each instance's
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
			const instanceId = head.name.slice(CHAIN_VAR_PREFIX.length);
			if (instanceId.length === 0) continue;
			for (const entry of readChain(handle.store, instanceId)) {
				if (entry.payload.type !== "turn") continue;
				const value = entry.payload.value as TurnValue;
				if (typeof value.content !== "string") continue;
				entries.push({
					instanceId,
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
