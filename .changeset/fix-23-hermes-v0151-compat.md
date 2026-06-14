---
"@sumeru/adapter-hermes": patch
---

fix(adapter-hermes): hermes v0.15.1 compatibility (closes #23).

- `createSession` now merges `stderr + stdout` when searching for the session
  id line. hermes v0.15.1 emits `session_id: <id>` to **stderr** under
  `--quiet --pass-session-id`; previously the adapter only scanned stdout and
  always rejected with `failed to parse Hermes session id`.
- `SESSION_LINE_RE` accepts both formats: `/^(?:Session:|session_id:)\s+(\S+)\s*$/m`.
  Legacy `Session: <id>` (stdout, non-quiet mode) still works; new
  `session_id: <id>` (stderr, --quiet mode) now works too. The parse-failure
  error message includes both streams so debugging is no longer one-eyed.
- New JSONL-first turn reader (`src/jsonl.ts`): `getTurns` and `send` first
  look for `~/.hermes/sessions/<nativeId>.jsonl`. Hermes v0.15.1 writes turn
  history there, not into `sessions.db` (which is empty under v0.15.1). The
  SQLite path remains as a fallback for older hermes builds.
- `db.ts` now detects schema shape at read time and supports the uwf-shaped
  v2 layout (`sessions(id, model, started_at, …)` + `messages(session_id,
  role, content, reasoning, tool_calls)`) in addition to the legacy v1
  shape. The new `SCHEMA_VERSION_DB = 2` constant is exported alongside
  the existing `SCHEMA_VERSION = 1`.
- `HermesAdapterOptions` gains two `T | null` fields: `sessionsDir`
  (defaults to `~/.hermes/sessions`) and `jsonlReader` (test seam parallel
  to `turnsReader`).
- Empty JSONL → `[]` (legitimate "session created, no turns yet"); JSONL
  exists but every line is malformed → fall through to DB; one bad line is
  skipped silently. Missing JSONL + missing DB → `[]`, not an error.
