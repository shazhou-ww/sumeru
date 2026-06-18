---
scenario: "rebuildSearchIndex walks the ocas store via listByType to enumerate all session-meta and turn nodes, using sumeru_session_turns for turn→session association, then rebuilds the FTS5 index without requiring the caller to supply roots"
feature: server-search
tags: [search, fts5, rebuild, ocas, listByType, phase-5]
---

## Given
- The FTS5 search index spec (`server-fts5-index.md`) describes `rebuildSearchIndex(searchIndex, ocas)` as a helper that "walks every `@sumeru/session-meta` and `@sumeru/turn` node in the ocas store" and re-issues `indexSessionMeta` / `indexTurn` writes.
- `@ocas/core`'s `CasStore` exposes `listByType(typeHash: Hash, options?: ListOptions): ListEntry[]` which returns all node hashes of a given schema/type hash.
- `SearchRebuildOcas` already carries `store: Store`, `turnSchemaHash: Hash`, and `sessionMetaSchemaHash: Hash` — everything needed to enumerate nodes by schema.
- The `@sumeru/turn` CAS payload contains `{ index, role, content, timestamp, toolCalls, tokens }` — it does NOT carry `sessionId` or `gateway`. The turn→session association is maintained by the `sumeru_session_turns` table (Phase 6), which maps `(session_id, turn_index) → turn_hash` and is explicitly NOT deleted by `rebuild()`.
- The current implementation of the internal `rebuild(ocas)` closure in `sqlite-index.ts` only DELETEs from `sumeru_turn_index` and `sumeru_session_index`, then discards the `ocas` argument (`void ocas`).
- The current public `rebuildSearchIndex(index, ocas, roots)` requires a third parameter `roots: Array<{ metaHash: Hash; turnHashes: Hash[] }>` — forcing callers to build the list themselves.

## When
- `rebuildSearchIndex(searchIndex, ocas)` is called (two-argument form, no `roots` parameter).

## Then
- **Signature change** — `rebuildSearchIndex` takes exactly two parameters: `(index: SearchIndex, ocas: SearchRebuildOcas)`. The third `roots` parameter is removed. Callers no longer need to enumerate sessions themselves.
- **Internal `rebuild(ocas)` performs the full walk** — The closure replaces `void ocas` with:
  1. Read the `sumeru_session_turns` table BEFORE any deletes — build a lookup map: `turnHash → sessionId` (since this table survives the rebuild and is the authoritative source of the turn→session association).
  2. `DELETE FROM sumeru_turn_index; DELETE FROM sumeru_session_index;` (existing behaviour, inside a transaction for the DELETE phase). `sumeru_session_turns` is NOT touched (it remains the durable turn-list pointer per Phase 6 spec).
  3. Enumerate all session-meta nodes: `ocas.store.cas.listByType(ocas.sessionMetaSchemaHash)` → `ListEntry[]`.
  4. For each `ListEntry`, call `ocas.store.cas.get(entry.hash)` to read the `CasNode` payload (`{ id, gateway, adapter, createdAt, config, resolvedCwd }`).
  5. Call `indexSessionMeta(...)` with `{ sessionId: payload.id, gateway: payload.gateway, adapter: payload.adapter, createdAt: payload.createdAt, metaHash: entry.hash }`.
  6. Build a map: `sessionId → gateway` from the session-meta results (needed to fill `gateway` when indexing turns).
  7. Enumerate all turn nodes: `ocas.store.cas.listByType(ocas.turnSchemaHash)` → `ListEntry[]`.
  8. For each turn `ListEntry`:
     - `ocas.store.cas.get(entry.hash)` → read `CasNode` payload (`{ index, role, content, timestamp, ... }`).
     - Look up `sessionId` from the `turnHash → sessionId` map (built in step 1 from `sumeru_session_turns`).
     - Look up `gateway` from the `sessionId → gateway` map (built in step 6).
     - If either lookup fails (orphaned turn — data inconsistency), skip the turn silently (no crash). Log once at warn level: `[sumeru] rebuild: skipping orphaned turn <hash>`.
     - Call `indexTurn(...)` with `{ turnHash: entry.hash, sessionId, gateway, turnIndex: payload.index, role: payload.role, content: payload.content, createdAt: payload.timestamp }`.
  9. After all turns are indexed, run a corrective UPDATE to fix `turn_count` and `last_active_at` (because `indexTurn`'s `ON CONFLICT DO NOTHING` means the `turn_count + 1` increment only fires on first insert, which is correct here since we cleared the table, but a bulk UPDATE is more robust against edge cases):
     ```sql
     UPDATE sumeru_session_index
        SET turn_count = (
              SELECT COUNT(*) FROM sumeru_turn_index
               WHERE sumeru_turn_index.session_id = sumeru_session_index.session_id
            ),
            last_active_at = COALESCE(
              (SELECT MAX(created_at) FROM sumeru_turn_index
                WHERE sumeru_turn_index.session_id = sumeru_session_index.session_id),
              sumeru_session_index.created_at
            );
     ```
- **Ordering** — Session-meta nodes are indexed BEFORE turn nodes so that `indexTurn`'s `UPDATE sumeru_session_index SET ... WHERE session_id = ?` finds the row. The corrective UPDATE in step 9 ensures final counts are accurate regardless of insertion order.
- **Idempotent** — Because `indexSessionMeta` uses `ON CONFLICT(session_id) DO NOTHING` and `indexTurn` uses `ON CONFLICT(turn_hash) DO NOTHING`, calling `rebuildSearchIndex` multiple times produces the same end state.
- **After rebuild, search works** — Calling `searchSessions` after `rebuildSearchIndex` returns the same hits as before the index was wiped. The test scenario:
  1. Write N sessions with M turns each via the normal recording path (through the message endpoint or direct `indexSessionMeta` / `indexTurn`).
  2. Verify `searchSessions` returns expected hits.
  3. Manually `DELETE FROM sumeru_turn_index; DELETE FROM sumeru_session_index;` (simulating index corruption).
  4. Verify `searchSessions` returns 0 hits.
  5. Call `rebuildSearchIndex(searchIndex, ocas)` (two args only).
  6. Verify `searchSessions` returns the same hits as step 2, including correct `turn_count` and `last_active_at`.
- **No new dependencies** — `listByType` is already available on `CasStore` (in `@ocas/core@0.5.0`). No new imports beyond what `SearchRebuildOcas` already provides.
- **Backward compat** — Any caller that previously used the three-argument form `rebuildSearchIndex(index, ocas, roots)` must be updated to use the two-argument form. Since the function now auto-discovers from the store + `sumeru_session_turns`, the `roots` parameter is redundant.
- **`pnpm run build`**, **`pnpm run check`**, and **`pnpm run test`** all pass.
