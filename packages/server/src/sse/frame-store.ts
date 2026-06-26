/**
 * Phase A3 (RFC #107) — durable SSE frame persistence.
 *
 * Stores an ordered index of CAS frame hashes per-send so the resume handler
 * can replay the full event stream from CAS after a server restart or when the
 * in-memory ring buffer has been exhausted/expired.
 *
 * The table lives in the same `_store.db` that `@ocas/fs` and the search index
 * write to. A separate `DatabaseSync` handle is opened (safe under WAL mode).
 */

import { DatabaseSync } from "node:sqlite";

export type SseFrameStore = {
	appendFrame: (
		sessionId: string,
		nonce: string,
		seq: number,
		frameHash: string,
	) => void;
	getLatestNonce: (sessionId: string) => string | null;
	getFrames: (
		sessionId: string,
		nonce: string,
	) => Array<{ seq: number; frameHash: string }>;
	close: () => void;
};

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sumeru_sse_frames (
  session_id  TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  frame_hash  TEXT NOT NULL,
  PRIMARY KEY (session_id, nonce, seq)
);
CREATE INDEX IF NOT EXISTS idx_sumeru_sse_frames_session
  ON sumeru_sse_frames(session_id);
`;

export function createSseFrameStore(dbPath: string): SseFrameStore {
	const db = openWithRetry(dbPath);
	try {
		db.exec("BEGIN");
		db.exec(SCHEMA_DDL);
		db.exec("COMMIT");
	} catch (err) {
		try {
			db.exec("ROLLBACK");
		} catch {
			// best-effort
		}
		const cause = err instanceof Error ? err.message : String(err);
		throw new Error(`failed to create SSE frame store: ${cause}`);
	}

	const insertFrame = db.prepare(`
		INSERT INTO sumeru_sse_frames (session_id, nonce, seq, frame_hash)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(session_id, nonce, seq) DO NOTHING
	`);

	const selectLatestNonce = db.prepare(`
		SELECT nonce
		  FROM sumeru_sse_frames
		 WHERE session_id = ?
		 ORDER BY rowid DESC
		 LIMIT 1
	`);

	const selectFrames = db.prepare(`
		SELECT seq, frame_hash
		  FROM sumeru_sse_frames
		 WHERE session_id = ? AND nonce = ?
		 ORDER BY seq ASC
	`);

	function appendFrame(
		sessionId: string,
		nonce: string,
		seq: number,
		frameHash: string,
	): void {
		insertFrame.run(sessionId, nonce, seq, frameHash);
	}

	function getLatestNonce(sessionId: string): string | null {
		const row = selectLatestNonce.get(sessionId) as
			| { nonce: string }
			| undefined;
		return row?.nonce ?? null;
	}

	function getFrames(
		sessionId: string,
		nonce: string,
	): Array<{ seq: number; frameHash: string }> {
		const rows = selectFrames.all(sessionId, nonce) as Array<{
			seq: number;
			frame_hash: string;
		}>;
		return rows.map((r) => ({
			seq: Number(r.seq),
			frameHash: r.frame_hash,
		}));
	}

	function close(): void {
		db.close();
	}

	return { appendFrame, getLatestNonce, getFrames, close };
}

function openWithRetry(dbPath: string): DatabaseSync {
	let lastErr: unknown = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const db = new DatabaseSync(dbPath);
			db.exec("PRAGMA journal_mode = WAL");
			db.exec("PRAGMA foreign_keys = ON");
			return db;
		} catch (err) {
			lastErr = err;
			const msg = err instanceof Error ? err.message : String(err);
			if (!/busy/i.test(msg) && !/locked/i.test(msg)) throw err;
			const start = Date.now();
			while (Date.now() - start < 50) {
				/* spin */
			}
		}
	}
	const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
	throw new Error(`failed to create SSE frame store: ${cause}`);
}
