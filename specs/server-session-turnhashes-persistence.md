---
scenario: "A session's turnHashes pointer survives a server restart: after restart, GET .../messages returns the same ordered turn list it returned before, sourced from disk instead of an in-memory array"
feature: server-ocas
tags: [ocas, session, turn, persistence, restart, rehydrate, sqlite, phase-6, refs-399]
---

## Given
- Phase-4 / Phase-5 are complete:
  - Each user/assistant turn is written to ocas as an immutable `@sumeru/turn` node (`server-ocas-turn-recording.md`). The turn CONTENT is already durable.
  - Each turn is also indexed into the SQLite `sumeru_turn_index` table by `SearchIndex.indexTurn` on the hot path (`server-fts5-index.md`), BEFORE `sessions.appendTurnHash` is called.
  - `sumeru_session_index` holds one durable row per session: `session_id, gateway, adapter, status, created_at, last_active_at, turn_count`.
  - `@sumeru/session-meta` is recorded to ocas on create (`server-ocas-session-meta.md`); its hash is `Session.metaHash`. The meta node carries `{ id, gateway, adapter, createdAt, config }` and is immutable.
- The DEFECT this spec fixes (Refs #399): the ordered turn-list pointer `Session.turnHashes` is an **in-memory-only** array.
  - `packages/server/src/session/store.ts` initializes `turnHashes: []` on `create` and only does `session.turnHashes.push(hash)` in `appendTurnHash` — nothing is written to disk for the LIST.
  - `createSessionStore(ocas)` builds a fresh empty `byGateway = new Map()` on every process start. No rehydration path exists. `byGateway` and `nativeRefs` are pure in-memory Maps.
  - Consequence: after a server restart, `GET /gateways/:name/sessions/:id/messages` (handler.ts, sources `session.turnHashes`) sees `turnHashes.length === 0` for previously-recorded sessions — the turn history reads as empty, even though every turn node and `sumeru_turn_index` row is still on disk. The user-visible turn list is silently lost.
- Constraint: REUSE existing infrastructure. The fix MUST persist the list pointer in the already-open `<ocasDir>/_store.db` SQLite database (the same file `@ocas/fs` and the FTS5 search index share) OR via the ocas `var` table. NO new storage dependency, NO new on-disk file, NO new npm package may be introduced.
- The `Session` wire envelope is unchanged: `toWire` still strips `metaHash` and `turnHashes`. This spec changes only WHERE `turnHashes` is sourced, never the HTTP shape.

## When
- A server boots with `--ocas-dir <DIR>` (DIR is a fresh tmpdir for the test).
- A session `ses_<X>` is created on `hermes` and N turns are recorded against it (1 user + assistant turns) via the message endpoint, exactly as in `server-ocas-turn-recording.md`. Say this yields `turnHashes = [h0, h1, … h(N-1)]` in chronological order.
- The client reads history once before restart:
  ```
  GET /gateways/hermes/sessions/ses_<X>/messages
  ```
  and records the returned `value.total` (= N) and the ordered list of `value.turns[*].hash`.
- The server process stops (`startedServer.stop()`), then a NEW server process boots against the **same** `--ocas-dir <DIR>`.
- The client re-issues `GET /gateways/hermes/sessions/ses_<X>/messages` against the new process.

## Then
- **Restart-equivalence (the user-visible goal)** —
  - The post-restart `GET .../messages` returns `value.total === N` — identical to the pre-restart value. Before this fix it would be `0`.
  - `value.turns` has length N (subject to the same `offset`/`limit` paging contract as `server-message-history-endpoint.md`), and `value.turns[i].hash === h_i` for every `i` — same hashes, SAME ORDER as before restart.
  - Each returned turn's body is byte-identical to the pre-restart read (it is fetched from the immutable ocas node by hash — `config.ocas.store.cas.get(h)`), so `role`, `content`, `index`, `timestamp`, `toolCalls`, `tokens` all round-trip.
  - The session itself is visible after restart: `GET /gateways/hermes/sessions/ses_<X>` returns `200` with `status` preserved (a closed session restores as `closed`, an idle/active session restores as `idle` — see status note below), and `GET /gateways/hermes/sessions` lists it.
- **Where the list pointer lives** — a durable, ordered, per-session turn-hash list is persisted in the existing `_store.db` SQLite (sibling to the FTS5 tables). The concrete table/migration is specced in `server-session-turns-table.md`. The list is keyed by `(session_id, turn_index)` and stores `turn_hash`; ordering is by `turn_index ASC`. (Implementation MAY instead use the ocas `var` table keyed per session — either is acceptable so long as every other `Then` here holds. The reference implementation uses the SQLite table because the turn rows already live in that DB.)
- **`appendTurnHash` persists synchronously** —
  - `appendTurnHash(gateway, id, hash)` continues to push onto the in-memory `session.turnHashes`, AND writes one durable row recording `(session_id, turn_index, turn_hash)` where `turn_index` is the position in the list (i.e. the value of `session.turnHashes.length` BEFORE the push — the 0-based append index).
  - The write is idempotent on `(session_id, turn_index)`: re-appending the same position is a no-op (no duplicate, no throw). This mirrors the idempotency already used by `indexTurn` on `turn_hash`.
  - Append order on disk reflects insertion order; the user turn (index 0 for a fresh session) is row 0, the first assistant turn is row 1, etc. — matching the in-memory array exactly.
  - Failure semantics: a persistence failure in `appendTurnHash` is surfaced (it MUST NOT silently swallow the error and leave disk behind memory). Because the turn node and `sumeru_turn_index` row are already written by this point on the message path, the recommended behavior is to let the throw propagate so the caller's existing error handling in `packages/server/src/sse/messages.ts` can react. (The message handler already wraps `recordPayload` / `indexTurn` in try/catch and emits `event: error` / 500; `appendTurnHash` joining that failure surface is acceptable. Do NOT introduce a silent divergence between memory and disk.)
- **Rehydration on store construction** —
  - `createSessionStore` gains access to a persistence reader (the SQLite handle the search index already owns, exposed through `OcasConfig`, OR a new read function on the search-index/persistence module — implementer's choice, but it MUST reuse the existing DB handle, not open a third one).
  - On construction, BEFORE serving any request, the store rebuilds `byGateway` from disk:
    1. Read every row from `sumeru_session_index` → one skeleton `Session` per row: `{ id, gateway, status, createdAt, … }`. `status` comes from the persisted column; `gateway` keys the inner map.
    2. For each session, recover `config` and `metaHash`:
       - `metaHash` is read from a persisted column (see `server-session-turns-table.md`: `sumeru_session_index` gains a `meta_hash` column) OR re-derived. `config` is read from the immutable `@sumeru/session-meta` ocas node at `metaHash` (`store.cas.get(metaHash).payload.config`). If the meta node is missing/unreadable, `config` falls back to `{}` and a structured warning is logged — the session is still listed (turn history is the priority).
    3. `turnHashes` is loaded from the persisted list pointer, ordered by `turn_index ASC`, producing the exact `[h0 … h(N-1)]` array.
  - Insertion order into the inner `Map<id, Session>` is by `created_at ASC` so `sessions.list(gateway)` stays chronological (matching the pre-restart contract from `server-sessions-list-endpoint.md`).
- **`nativeRef` is NOT rehydrated (documented non-goal)** —
  - The adapter-side `NativeSessionRef` is live runtime state, not persisted (it never was). After restart, `getNativeRef(gateway, id)` returns `null` for a rehydrated session.
  - Therefore a rehydrated session is **read-complete but not resumable for new sends**: `GET .../messages` (history) works fully; `POST .../messages` (new send) hits the existing `nativeRef === null` branch in `messages.ts` and returns `503 adapter_unavailable` (its current behavior — unchanged, just now reachable for restored sessions). Re-establishing native refs across restart is explicitly OUT OF SCOPE for #399.
- **Status on restart** — A session persisted as `closed` restores as `closed`. A session persisted as `idle` or `active` restores as `idle` (a process restart cannot leave a send mid-flight; `active` is a transient in-memory state, so it normalizes to `idle` on load — never restored as `active`). The status column is the source of truth for closed/not-closed.
- **No double counting / no drift** — After restart, `appendTurnHash` for a brand-new turn continues from the rehydrated length: a session restored with N turns gets index N for its next appended turn. The next user turn's `index` (computed in `messages.ts` as `session.turnHashes.length`) is therefore N, with no gap or collision against the restored 0…N-1.
- **Backward / empty cases** —
  - A session with zero turns restores with `turnHashes: []` and `GET .../messages` returns `total: 0` (unchanged).
  - Opening an OLD `_store.db` that predates the list-pointer table does not crash: the migration in `server-session-turns-table.md` creates the table `IF NOT EXISTS`; sessions whose turns were recorded before the column existed restore with whatever rows are present (possibly empty) and are NOT a hard error. Forward-only; no backfill is required by this spec (a `rebuild`-style backfill MAY be added later).

## Tests
- **Step 1 — persistence round-trip unit test** (`packages/server/tests/session-turnhashes-persistence.test.ts`):
  - Build an `OcasConfig` over a tmp `--ocas-dir` (reuse the `makeOcas()` helper pattern from `session-store.test.ts`).
  - `const store = createSessionStore(ocas)`; create a session; append N (e.g. 5) real turn hashes via `appendTurnHash` (each hash is a genuine `recordPayload(store, turnSchemaHash, <turn>)` so it exists in ocas).
  - Construct a SECOND store over the SAME ocas/db handle to simulate a restart: `const store2 = createSessionStore(ocas)`.
  - Assert `store2.get(gateway, id)` is non-null and its `turnHashes.length === N`.
  - Assert `store2.get(gateway, id).turnHashes` deep-equals the original `[h0 … h4]` IN ORDER.
  - Assert every restored hash resolves in ocas: `ocas.store.cas.get(h) !== null` for each, and the decoded payload matches the turn that was appended.
  - Idempotency: appending the same `(session_id, index)` twice does not create a duplicate row and the rehydrated list still has length N.
- **Process-level restart semantics** (`packages/server/tests/session-turnhashes-restart.test.ts`, mirrors the e2e/bootstrap test style):
  - `startServer({ ocasDir: DIR, … })`; create a session on `hermes`; POST a message that records 1 user + K assistant turns (stubbed adapter, as in `ocas-turn-recording.test.ts`).
  - `GET .../messages` → capture `total` (= 1 + K) and `turns[*].hash`.
  - `await started.stop()`.
  - `startServer({ ocasDir: DIR, … })` again (same dir, same gateways/adapters config).
  - `GET .../messages` on the new process → `total` equals the captured value and `turns[*].hash` equals the captured list in the same order. (Pre-fix this assertion fails because `total` is 0.)
  - `GET /gateways/hermes/sessions/ses_<X>` → `200`, session visible after restart, status preserved.
  - `POST .../messages` on the restored session → `503 adapter_unavailable` (nativeRef not rehydrated — documents the non-goal explicitly).
  - Restart twice in a row with no new turns → `total` stable (no duplication, no growth).
- **Empty session restart**: create a session, record no turns, restart → session visible, `GET .../messages` `total: 0`.
- All pre-existing Phase 1–5 tests continue to pass unchanged. The only observable production change is that turn history survives restart; the HTTP wire shapes are byte-identical.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.

## Constraints (implementation discipline — from CLAUDE.md)
- Functional-first: `type` over `interface`, `function` + closures over `class`. The persistence reader/writer is a closure (mirroring `createSearchIndex`), not a class.
- Folder module discipline: new code lives under an existing module (`session/` or `search/`); the folder re-exports through its `index.ts` (pure re-exports), types in `types.ts`.
- Named exports only; ESM `.js` import specifiers.
- No optional properties — use `T | null`, never `?:`.
- Structured logging only: emit warnings/info through the same `[sumeru]`-prefixed logging convention the rest of the server uses (e.g. the existing `console.warn("[sumeru] …")` calls in `sqlite-index.ts` / `store.ts`); do NOT introduce bare `console.log` without the `[sumeru]` prefix, and do NOT add new ad-hoc logging styles. Rehydration emits one info line at boot, e.g. `[sumeru] rehydrated <S> sessions, <T> turns from <DIR>`, consistent with the existing `[sumeru] search index ready: <n> turns indexed` line.
- A changeset `@sumeru/server: minor` MUST be added describing the persistence + rehydration behavior.
- Commit author `小橘 <xiaoju@shazhou.work>`; commit message references `Refs #399`. Land via PR to `main` (no direct push).
