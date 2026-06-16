---
"@sumeru/server": minor
---

Persist session `turnHashes` across server restart (Refs #399).

Previously the ordered per-session turn-list pointer (`Session.turnHashes`)
was an in-memory-only array: although every turn's CONTENT was already
durable in ocas, the LIST was rebuilt empty on every boot, so after a
restart `GET /gateways/:name/sessions/:id/messages` returned `total: 0` for
previously-recorded sessions. The turn history was silently lost.

- New `sumeru_session_turns(session_id, turn_index, turn_hash,
  PRIMARY KEY (session_id, turn_index))` table in the existing
  `<ocasDir>/_store.db` (sibling to the FTS5 tables — no new storage
  dependency, no second DB handle). `SessionStore.appendTurnHash` now
  persists one idempotent row (`ON CONFLICT DO NOTHING`) at the 0-based
  append position synchronously, BEFORE mutating the in-memory array, so
  disk never lags memory. The table is never cleared by the FTS `rebuild()`
  path, so the turn-list pointer is durable independent of search re-indexing.
- New nullable `meta_hash` column on `sumeru_session_index` (added on fresh
  DBs via the `CREATE TABLE` DDL, and on legacy DBs via a pragma-guarded
  `ALTER TABLE … ADD COLUMN` migration inside the existing boot transaction).
  `indexSessionMeta` persists it so a restart can recover each session's
  opaque `config` from the immutable `@sumeru/session-meta` node.
  `SessionMetaInput` gains a required `metaHash: Hash | null` field.
- `createSessionStore` now rehydrates `byGateway` from disk on construction,
  BEFORE serving any request: it reads `sumeru_session_index` (ordered by
  `created_at ASC`) and bulk-loads every session's ordered turn hashes in a
  single query. A closed session restores as `closed`; an idle/active session
  restores as `idle` (a restart can never leave a send mid-flight, so the
  transient `active` state normalizes to `idle`). When a session's `meta_hash`
  is `null` or its meta node is unreadable, `config` falls back to `{}` with a
  structured `[sumeru]` warning — turn history is the priority. Boot emits one
  `[sumeru] rehydrated <S> sessions, <T> turns` line.
- New `SearchIndex` methods (closure over the single existing `DatabaseSync`
  handle): `appendSessionTurn`, `listSessionTurns`, `loadSessionTurnsBulk`,
  `loadSessionRows`. `PersistedSessionRow` type exported.
- Documented non-goal: the adapter-side `NativeSessionRef` is live runtime
  state and is NOT persisted. A rehydrated session is read-complete (history
  works fully) but not resumable for new sends — `POST .../messages` hits the
  existing `nativeRef === null` branch and returns `503 adapter_unavailable`.
  The message endpoint surfaces any turn-list persistence failure as
  `turn_persist_failed` (clean 500 before the stream for the user turn; an
  in-stream `event: error` for assistant turns) rather than silently diverging
  memory from disk.

The HTTP wire shapes are byte-identical; the only observable change is that
turn history now survives a server restart.
