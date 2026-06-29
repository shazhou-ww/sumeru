import { mkdirSync } from "node:fs";
import {
	bootstrap,
	type Hash,
	type JSONSchema,
	putSchema,
	type Store,
} from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";
import type { OutboxFrame, TurnValue } from "@sumeru/adapter-core";

/**
 * `@sumeru/chain-node` — one link in a session's append-only CAS chain.
 *
 * Every emitted outbox frame (turn / done / suspend / error) is stored as an
 * immutable CAS node carrying a `prev` pointer to the node that preceded it.
 * The newest node's hash is tracked by the per-session head variable
 * `@sumeru/chain/<sessionId>`, so the whole chain is recoverable by walking
 * `prev` from the head back to the first node (where `prev === null`).
 *
 * `prev` is declared `format: ocas_ref` so closure / gc traversal follows the
 * chain edge. `value` is the opaque frame payload — its shape is determined by
 * the frame `type` and validated upstream by `@sumeru/adapter-core`.
 */
export const SUMERU_CHAIN_NODE_SCHEMA: JSONSchema = {
	title: "@sumeru/chain-node",
	description:
		"One link in a session's append-only CAS chain of outbox frames.",
	type: "object",
	additionalProperties: false,
	required: ["prev", "type", "value", "timestamp"],
	properties: {
		prev: {
			anyOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
		},
		type: { type: "string", enum: ["turn", "done", "suspend", "error"] },
		value: { type: "object" },
		timestamp: { type: "string", format: "date-time" },
	},
};

/** Payload of a `@sumeru/chain-node` CAS node. */
export type ChainNodePayload = {
	prev: Hash | null;
	type: OutboxFrame["type"];
	value: OutboxFrame["value"];
	timestamp: string;
};

/** One decoded chain node paired with its own CAS hash. */
export type ChainEntry = {
	hash: Hash;
	payload: ChainNodePayload;
};

/** A recorded turn frame, surfaced to history/search with its real CAS hash. */
export type TurnRecord = {
	timestamp: string;
	type: "turn";
	value: TurnValue;
	hash: Hash;
};

export type OcasRecorder = {
	/** Append `frame` to the session chain; returns the new node's CAS hash. */
	append(sessionId: string, frame: OutboxFrame): Hash;
	getTurns(sessionId: string, limit: number, offset: number): Array<TurnRecord>;
	getTurnTotal(sessionId: string): number;
	/** Drop the session head pointer so its chain is no longer reachable. */
	clear(sessionId: string): void;
};

/** Handle to an opened on-disk Sumeru CAS store plus its chain schema hash. */
export type OcasStoreHandle = {
	store: Store;
	chainSchemaHash: Hash;
	close(): void;
};

/** The head-pointer variable name for a session's chain. */
export function chainHeadVarName(sessionId: string): string {
	return `@sumeru/chain/${sessionId}`;
}

/**
 * Open (or create) the on-disk CAS store at `dataDir`: an `@ocas/fs`
 * filesystem CAS sub-store plus a SQLite-backed var/tag store. Runs bootstrap
 * so the schema-of-schemas exists, then registers `@sumeru/chain-node`.
 *
 * Synchronous: `@ocas/fs` initialises its hasher at import time, so the FS
 * store hashes payloads with the synchronous code path.
 */
export function openOcasStore(dataDir: string): OcasStoreHandle {
	mkdirSync(dataDir, { recursive: true });
	const cas = createFsStore(dataDir);
	const sqlite = createSqliteVarStore(dataDir, cas);
	const store: Store = { cas, var: sqlite.var, tag: sqlite.tag };
	bootstrap(store);
	const chainSchemaHash = putSchema(store, SUMERU_CHAIN_NODE_SCHEMA);
	return { store, chainSchemaHash, close: sqlite.close };
}

/**
 * Read a session's chain in chronological order (oldest first) by walking
 * `prev` from the head node. A `seen` set guards against cycles or a corrupted
 * `prev` pointer; a missing node simply terminates the walk.
 */
export function readChain(store: Store, sessionId: string): Array<ChainEntry> {
	const head = store.var.get(chainHeadVarName(sessionId));
	let cursor: Hash | null = head?.value ?? null;
	const seen = new Set<Hash>();
	const reversed: Array<ChainEntry> = [];
	while (cursor !== null && !seen.has(cursor)) {
		seen.add(cursor);
		const node = store.cas.get(cursor);
		if (node === null) break;
		const payload = node.payload as ChainNodePayload;
		reversed.push({ hash: cursor, payload });
		cursor = payload.prev;
	}
	reversed.reverse();
	return reversed;
}

export function createOcasRecorder(dataDir: string): OcasRecorder {
	const { store, chainSchemaHash } = openOcasStore(dataDir);

	function append(sessionId: string, frame: OutboxFrame): Hash {
		const head = store.var.get(chainHeadVarName(sessionId));
		const payload: ChainNodePayload = {
			prev: head?.value ?? null,
			type: frame.type,
			value: frame.value,
			timestamp: new Date().toISOString(),
		};
		const hash = store.cas.put(chainSchemaHash, payload);
		store.var.set(chainHeadVarName(sessionId), hash);
		return hash;
	}

	function turnRecords(sessionId: string): Array<TurnRecord> {
		const records: Array<TurnRecord> = [];
		for (const entry of readChain(store, sessionId)) {
			if (entry.payload.type !== "turn") continue;
			records.push({
				timestamp: entry.payload.timestamp,
				type: "turn",
				value: entry.payload.value as TurnValue,
				hash: entry.hash,
			});
		}
		return records;
	}

	function getTurns(
		sessionId: string,
		limit: number,
		offset: number,
	): Array<TurnRecord> {
		return turnRecords(sessionId).slice(offset, offset + limit);
	}

	function getTurnTotal(sessionId: string): number {
		return turnRecords(sessionId).length;
	}

	function clear(sessionId: string): void {
		store.var.remove(chainHeadVarName(sessionId));
	}

	return {
		append,
		getTurns,
		getTurnTotal,
		clear,
	};
}
