/**
 * Issue #59 — rebuildSearchIndex walks the ocas store.
 *
 * Tests that `rebuildSearchIndex(index, ocas)` enumerates session-meta and
 * turn nodes via `listByType`, uses `sumeru_session_turns` for turn→session
 * association, and rebuilds the FTS5 index without the caller supplying roots.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
	openSumeruOcas,
	rebuildSearchIndex,
	type SumeruOcas,
	searchSessions,
} from "../src/index.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-rebuild-walk-"));
}

/**
 * Helper: seed a session-meta node into the ocas store and index it.
 * Also records it into `sumeru_session_turns` for later lookup by rebuild.
 */
function seedFullSession(
	ocas: SumeruOcas,
	id: string,
	gateway: string,
	adapter: string,
	createdAt: string,
): void {
	// Write session-meta to CAS
	const metaPayload = {
		id,
		gateway,
		adapter,
		createdAt,
		config: null,
		resolvedCwd: null,
	};
	ocas.store.cas.put(ocas.sessionMetaSchemaHash, metaPayload);
	// Index it
	ocas.searchIndex.indexSessionMeta({
		sessionId: id,
		gateway,
		adapter,
		createdAt,
		metaHash: null,
	});
}

/**
 * Helper: write a turn to CAS, index it, and record in sumeru_session_turns.
 */
function seedFullTurn(
	ocas: SumeruOcas,
	sessionId: string,
	gateway: string,
	turnIndex: number,
	role: "user" | "assistant",
	content: string,
	timestamp: string,
): void {
	const turnPayload = {
		index: turnIndex,
		role,
		content,
		timestamp,
		toolCalls: null,
		tokens: null,
	};
	const turnHash = ocas.store.cas.put(ocas.turnSchemaHash, turnPayload);
	// Index the turn in FTS
	ocas.searchIndex.indexTurn({
		turnHash,
		sessionId,
		gateway,
		turnIndex,
		role,
		content,
		createdAt: timestamp,
	});
	// Record in sumeru_session_turns (the durable pointer table)
	ocas.searchIndex.appendSessionTurn(sessionId, turnIndex, turnHash);
}

/**
 * Helper: directly wipe the FTS index tables (simulating corruption).
 */
function wipeIndexTables(dir: string): void {
	const db = new DatabaseSync(join(dir, "_store.db"));
	db.exec("DELETE FROM sumeru_turn_index");
	db.exec("DELETE FROM sumeru_session_index");
	db.close();
}

describe("Issue #59 — rebuildSearchIndex walks ocas store", () => {
	it("two-argument rebuildSearchIndex restores index after wipe", () => {
		const dir = tmpOcasDir();
		const ocas = openSumeruOcas(dir);

		// Step 1: Write 2 sessions with turns via the normal recording path
		seedFullSession(ocas, "ses_A", "hermes", "stub", "2026-01-01T00:00:00Z");
		seedFullTurn(
			ocas,
			"ses_A",
			"hermes",
			0,
			"user",
			"login redirect bug",
			"2026-01-01T00:00:01Z",
		);
		seedFullTurn(
			ocas,
			"ses_A",
			"hermes",
			1,
			"assistant",
			"I found the issue in auth middleware",
			"2026-01-01T00:00:02Z",
		);

		seedFullSession(
			ocas,
			"ses_B",
			"claude-code",
			"stub",
			"2026-01-02T00:00:00Z",
		);
		seedFullTurn(
			ocas,
			"ses_B",
			"claude-code",
			0,
			"user",
			"deploy timeout on staging server",
			"2026-01-02T00:00:01Z",
		);

		// Step 2: Verify searchSessions returns expected hits
		const beforeWipe = searchSessions(ocas.searchIndex, {
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(beforeWipe.total).toBe(1);
		expect(beforeWipe.results[0]?.id).toBe("ses_A");
		expect(beforeWipe.results[0]?.turns).toBe(2);
		expect(beforeWipe.results[0]?.lastActiveAt).toBe("2026-01-01T00:00:02Z");

		const beforeDeploy = searchSessions(ocas.searchIndex, {
			query: "deploy",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(beforeDeploy.total).toBe(1);
		expect(beforeDeploy.results[0]?.id).toBe("ses_B");
		expect(beforeDeploy.results[0]?.turns).toBe(1);

		// Step 3: Simulate index corruption
		wipeIndexTables(dir);

		// Step 4: Verify searchSessions returns 0 hits
		const afterWipe = searchSessions(ocas.searchIndex, {
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(afterWipe.total).toBe(0);

		// Step 5: Call rebuildSearchIndex (two args only)
		rebuildSearchIndex(ocas.searchIndex, {
			store: ocas.store,
			turnSchemaHash: ocas.turnSchemaHash,
			sessionMetaSchemaHash: ocas.sessionMetaSchemaHash,
		});

		// Step 6: Verify search returns same hits including correct turn_count
		const afterRebuild = searchSessions(ocas.searchIndex, {
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(afterRebuild.total).toBe(1);
		expect(afterRebuild.results[0]?.id).toBe("ses_A");
		expect(afterRebuild.results[0]?.turns).toBe(2);
		expect(afterRebuild.results[0]?.lastActiveAt).toBe("2026-01-01T00:00:02Z");

		const afterRebuildDeploy = searchSessions(ocas.searchIndex, {
			query: "deploy",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(afterRebuildDeploy.total).toBe(1);
		expect(afterRebuildDeploy.results[0]?.id).toBe("ses_B");
		expect(afterRebuildDeploy.results[0]?.turns).toBe(1);
	});

	it("rebuild is idempotent — calling twice produces the same end state", () => {
		const dir = tmpOcasDir();
		const ocas = openSumeruOcas(dir);

		seedFullSession(ocas, "ses_X", "hermes", "stub", "2026-03-01T00:00:00Z");
		seedFullTurn(
			ocas,
			"ses_X",
			"hermes",
			0,
			"user",
			"test idempotent rebuild",
			"2026-03-01T00:00:01Z",
		);

		const rebuildOcas = {
			store: ocas.store,
			turnSchemaHash: ocas.turnSchemaHash,
			sessionMetaSchemaHash: ocas.sessionMetaSchemaHash,
		};

		// First rebuild
		rebuildSearchIndex(ocas.searchIndex, rebuildOcas);
		const afterFirst = searchSessions(ocas.searchIndex, {
			query: "idempotent",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(afterFirst.total).toBe(1);
		expect(afterFirst.results[0]?.turns).toBe(1);

		// Second rebuild — same result
		rebuildSearchIndex(ocas.searchIndex, rebuildOcas);
		const afterSecond = searchSessions(ocas.searchIndex, {
			query: "idempotent",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(afterSecond.total).toBe(1);
		expect(afterSecond.results[0]?.turns).toBe(1);
	});

	it("orphaned turns are skipped gracefully with a warning", () => {
		const dir = tmpOcasDir();
		const ocas = openSumeruOcas(dir);

		seedFullSession(ocas, "ses_A", "hermes", "stub", "2026-04-01T00:00:00Z");
		seedFullTurn(
			ocas,
			"ses_A",
			"hermes",
			0,
			"user",
			"orphan test normal turn",
			"2026-04-01T00:00:01Z",
		);

		// Write a turn to CAS but do NOT record it in sumeru_session_turns
		// (orphaned turn — no session association)
		const orphanPayload = {
			index: 99,
			role: "user",
			content: "orphan content that should be skipped",
			timestamp: "2026-04-01T00:00:05Z",
			toolCalls: null,
			tokens: null,
		};
		ocas.store.cas.put(ocas.turnSchemaHash, orphanPayload);

		// Wipe the index
		wipeIndexTables(dir);

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Rebuild should NOT crash
		rebuildSearchIndex(ocas.searchIndex, {
			store: ocas.store,
			turnSchemaHash: ocas.turnSchemaHash,
			sessionMetaSchemaHash: ocas.sessionMetaSchemaHash,
		});

		// The non-orphaned turn should still be indexed
		const result = searchSessions(ocas.searchIndex, {
			query: "orphan test normal",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(result.total).toBe(1);
		expect(result.results[0]?.id).toBe("ses_A");

		// The orphaned turn should have triggered a warning
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("[sumeru] rebuild: skipping orphaned turn"),
		);

		warnSpy.mockRestore();
	});

	it("session-meta nodes are indexed BEFORE turn nodes", () => {
		const dir = tmpOcasDir();
		const ocas = openSumeruOcas(dir);

		seedFullSession(ocas, "ses_Z", "hermes", "stub", "2026-05-01T00:00:00Z");
		seedFullTurn(
			ocas,
			"ses_Z",
			"hermes",
			0,
			"user",
			"ordering test content",
			"2026-05-01T00:00:01Z",
		);

		// Wipe index
		wipeIndexTables(dir);

		// Rebuild — turns need the session row to exist for the UPDATE bump
		rebuildSearchIndex(ocas.searchIndex, {
			store: ocas.store,
			turnSchemaHash: ocas.turnSchemaHash,
			sessionMetaSchemaHash: ocas.sessionMetaSchemaHash,
		});

		// The session row should have correct turn_count from corrective UPDATE
		const result = searchSessions(ocas.searchIndex, {
			query: "ordering",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(result.total).toBe(1);
		expect(result.results[0]?.turns).toBe(1);
		expect(result.results[0]?.lastActiveAt).toBe("2026-05-01T00:00:01Z");
	});

	it("corrective UPDATE fixes turn_count and last_active_at", () => {
		const dir = tmpOcasDir();
		const ocas = openSumeruOcas(dir);

		seedFullSession(ocas, "ses_C", "hermes", "stub", "2026-06-01T00:00:00Z");
		seedFullTurn(
			ocas,
			"ses_C",
			"hermes",
			0,
			"user",
			"corrective first turn",
			"2026-06-01T00:00:01Z",
		);
		seedFullTurn(
			ocas,
			"ses_C",
			"hermes",
			1,
			"assistant",
			"corrective second turn",
			"2026-06-01T00:00:02Z",
		);
		seedFullTurn(
			ocas,
			"ses_C",
			"hermes",
			2,
			"user",
			"corrective third turn",
			"2026-06-01T00:00:03Z",
		);

		// Wipe and rebuild
		wipeIndexTables(dir);
		rebuildSearchIndex(ocas.searchIndex, {
			store: ocas.store,
			turnSchemaHash: ocas.turnSchemaHash,
			sessionMetaSchemaHash: ocas.sessionMetaSchemaHash,
		});

		const result = searchSessions(ocas.searchIndex, {
			query: "corrective",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(result.total).toBe(1);
		expect(result.results[0]?.turns).toBe(3);
		expect(result.results[0]?.lastActiveAt).toBe("2026-06-01T00:00:03Z");
	});
});
