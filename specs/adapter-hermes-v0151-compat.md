---
scenario: "@sumeru/adapter-hermes is compatible with hermes v0.15.1: it parses session_id from stderr, accepts both `session_id:` and `Session:` line formats, and reads turn history from the per-session JSONL file with SQLite DB as fallback"
feature: adapter-hermes
tags: [adapter, hermes, compat, v0151, stderr, jsonl, fallback, bug-fix]
---

## Given
- `@sumeru/adapter-hermes` is built. Adapter constructed via `createHermesAdapter(options)`.
- Local environment has hermes v0.15.1 installed and reachable via `$PATH` (or via injected `spawnFn` in unit tests).
- For hermes v0.15.1:
  - `hermes chat -q "<query>" --pass-session-id --quiet` prints `session_id: <id>` to **stderr** (NOT stdout). Stdout contains only the model's reply (or nothing in some flows).
  - Session turn history is persisted to `~/.hermes/sessions/<nativeId>.jsonl` — one JSON object per line. The leading line is a `{"role": "session_meta", ...}` row; subsequent lines are `{"role": "user"|"assistant"|"tool"|..., "content": "...", "timestamp": "...", ...}`.
  - `~/.hermes/sessions.db` exists but is empty (no `messages` or `sessions` tables) under v0.15.1, so the previous direct-SQLite reader from `adapter-hermes-get-turns.md` fails with `schema mismatch: missing column 'session_id' in table 'messages'`.
  - A later hermes release may restore the SQLite schema described in `adapter-hermes-get-turns.md` (`sessions(id, model, started_at, input_tokens, output_tokens)` + `messages(session_id, role, content, reasoning, tool_calls)` per uwf's `@united-workforce/agent-hermes`). The adapter MUST treat SQLite as a fallback path, not the only path.
- The adapter options surface unchanged from `adapter-hermes-package-scaffold.md` plus two new optional fields (still `T | null`, no `?:`):
  - `sessionsDir: string | null` — directory holding per-session `.jsonl` files. Defaults to `~/.hermes/sessions`.
  - `jsonlReader: JsonlReader | null` — test seam for the JSONL reader, parallel to existing `turnsReader`.

## When

### Bug 1 + 2 — createSession parses session_id from stderr, in either format

Test stubs `spawnFn` to return:
```
stdout: ""
stderr: "session_id: 20260614_053824_4ead56\n"
exitCode: 0
```
Test calls:
```typescript
const ref = await adapter.createSession({ model: "anthropic/claude-haiku-4" });
```

A second variant returns the legacy stream pairing:
```
stdout: "Session: 20260614_053824_4ead56\n"
stderr: ""
exitCode: 0
```
and a third variant returns the new format on stdout (covers hypothetical future hermes versions that re-channel the line):
```
stdout: "session_id: 20260614_053824_4ead56\n"
stderr: ""
exitCode: 0
```

Internally the adapter:
1. Concatenates `result.stderr + "\n" + result.stdout` (stderr first — that's where v0.15.1 writes the id).
2. Matches `/^(?:Session:|session_id:)\s+(\S+)\s*$/m` against the merged buffer.
3. Validates the captured group against the existing `SESSION_ID_RE` (`/^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/`).

### Bug 3 — getTurns reads JSONL first, falls back to SQLite

Test fixtures under `packages/adapter-hermes/tests/fixtures/`:
- `sessions/20260614_jsonl_only.jsonl` — a v0.15.1-style JSONL file (no rows in any DB).
- `sessions/20260614_jsonl_and_db.jsonl` — same id present in both JSONL and DB; JSONL must win.
- `state-v0152.db` — a v0.15.2-style SQLite DB with the uwf-shaped schema (`sessions` + `messages` tables) and exactly one session row `20260614_db_only` whose JSONL file does NOT exist.
- `state-empty.db` — an empty SQLite file (mirrors v0.15.1: file exists, zero tables).

Test calls:
```typescript
const turnsJsonl  = await adapter.getTurns({ nativeId: "20260614_jsonl_only", meta: {} });
const turnsBoth   = await adapter.getTurns({ nativeId: "20260614_jsonl_and_db", meta: {} });
const turnsDbOnly = await adapter.getTurns({ nativeId: "20260614_db_only", meta: {} });
const turnsMiss   = await adapter.getTurns({ nativeId: "20260614_does_not_exist", meta: {} });
```

Internally the adapter, in order:
1. Looks for `<sessionsDir>/<nativeId>.jsonl`. If present, reads and parses it line-by-line.
2. Else, looks for the configured `dbPath`. If the file exists and contains a `sessions` table with column `id` (uwf-shaped schema), queries `sessions WHERE id = ?` and `messages WHERE session_id = ? ORDER BY id`.
3. Else, returns `[]` (NOT an error — matches `getTurns` empty-session semantics in `adapter-hermes-get-turns.md`).

### Bug 3 (continued) — send uses the same JSONL-first read path

Test stubs `spawnFn` for a `send` call. Before invoking the stub the test writes a JSONL fixture with 2 existing turns; after the stub resolves, the test rewrites the JSONL with 4 turns total. The adapter must:
1. Read the JSONL **before** spawn to compute the high-water index (`= 1`, since the existing turns have indices 0 and 1 derived from JSONL ordinal position).
2. Spawn `hermes chat -q "<content>" --resume <nativeId> --quiet --pass-session-id --source <sourceTag>`.
3. Read the JSONL **after** spawn and return only turns with `index > 1`.

## Then

### Bug 1 + 2 — session_id parsing

- All three `createSession` variants resolve with `ref.nativeId === "20260614_053824_4ead56"`. `ref.meta` shape unchanged from `adapter-hermes-create-session.md`.
- If `stderr === ""` AND `stdout === ""` (or neither contains a matching line) the adapter rejects with the existing `failed to parse Hermes session id` error, and the error body includes the first 500 chars of `stderr + "\n" + stdout` (not just stdout) so debugging shows both streams.
- The capture group is rejected via `SESSION_ID_RE` when malformed (e.g. `session_id: not-an-id`) with the existing `failed to parse Hermes session id (got '<x>', expected YYYYMMDD_HHMMSS_<hex>)` error.
- The behavior is asserted by **unit tests** under `packages/adapter-hermes/tests/create-session.test.ts` using a stubbed `spawnFn`. No new integration test is required; the existing `SUMERU_HERMES_INTEGRATION=1` test continues to cover the real binary.

### Bug 3 — JSONL-first reader

- `turnsJsonl.length >= 2`, with at least one `role: "user"` turn and one `role: "assistant"` turn, in source order. The leading `role: "session_meta"` JSONL row is filtered out (it is NOT a turn). Other non-{user,assistant,tool,system} rows are filtered out.
- Each emitted `Turn` matches the existing `@sumeru/core` shape from `adapter-hermes-get-turns.md`:
  - `index: number` — 0-based, assigned by the adapter from the filtered JSONL ordinal position (not from any field in the JSONL itself, since v0.15.1 JSONL has no `idx`).
  - `role: "user" | "assistant" | "system"` — `tool` rows are normalized to `assistant` (matches existing `normalizeRole` in `db.ts`).
  - `content: string` — never `null`/`undefined`; a JSONL row whose `content` is `null` (Hermes uses this for tool-call-only assistant turns) becomes the empty string `""`.
  - `timestamp: string` — ISO-8601 UTC ending in `Z`. The adapter parses the JSONL's `timestamp` field (which is plain ISO without `Z`, e.g. `"2026-04-19T22:37:06.567820"`) and normalizes via the existing `normalizeTimestamp` helper.
  - `toolCalls: ToolCall[] | null` — built from the JSONL row's `tool_calls` array using the same uwf-style `{function: {name, arguments}}` shape (name → `tool`, JSON-parsed `arguments` → `input`); `null` when the row has no `tool_calls`.
  - `tokens: TokenUsage | undefined` — `undefined` for JSONL-sourced turns (v0.15.1 JSONL does not include per-turn token counts), matching the existing `Turn.tokens?` optionality.
- `turnsBoth` returns the JSONL-derived turns. The DB row for the same id is NOT read (verified by a unit test that wraps the DB driver and asserts no SQL is executed when JSONL is present).
- `turnsDbOnly` returns turns from the SQLite DB using the uwf-shaped query. The DB reader is treated as schema v2 (the uwf shape) — distinct from the existing schema v1 reader in `adapter-hermes-get-turns.md` which is now reachable only via a legacy/test code path. The adapter exports `SCHEMA_VERSION_DB = 2` alongside the existing `SCHEMA_VERSION = 1`; the schema-mismatch error message references whichever version was attempted.
- `turnsMiss` resolves to `[]`. NOT an error (matches the existing empty-session semantics).
- If the JSONL file exists but every line fails to parse, the adapter falls through to the DB path. If a single line is malformed, that line is skipped silently and parsing continues — one bad line MUST NOT kill the whole read.
- If the JSONL file exists but is empty (zero bytes / zero parseable rows), the adapter returns `[]` and does NOT fall through to the DB. An empty JSONL means "session was created but never written to", which is a legitimate empty state.
- If `sessionsDir` and `dbPath` both refer to non-existent paths, the adapter returns `[]` (matches the "unknown session" semantics). The pre-existing `hermes session DB not found at <path>` error is no longer raised when the sessions directory is present and only the DB is missing.

### Bug 3 (continued) — send delta computation

- The `AgentResponse.turns` array contains exactly 2 entries (indices 2 and 3 in the post-send JSONL).
- `r.turns[0].role` and `r.turns[1].role` reflect the JSONL order (`user`, then `assistant`).
- Per-`nativeId` mutex, timeout, closed-ref rejection, and unicode argv handling from `adapter-hermes-send.md` continue to hold unchanged.
- The argv passed to `spawnFn` for `send` is unchanged from `adapter-hermes-send.md`: `["chat", "-q", content, "--resume", nativeId, "--pass-session-id", "--quiet", "--source", sourceTag]`.

### Cross-cutting

- The adapter exports no new public types beyond `HermesAdapterOptions.sessionsDir`, `HermesAdapterOptions.jsonlReader`, `JsonlReader`, and `SCHEMA_VERSION_DB = 2`. The `Adapter` contract surface from `@sumeru/core` is unchanged.
- The new JSONL reader lives in `packages/adapter-hermes/src/jsonl.ts` (parallel to `db.ts`); `index.ts` re-exports nothing new (it stays pure re-exports).
- Tests for the JSONL reader live in `packages/adapter-hermes/tests/jsonl.test.ts`. Tests for the fallback-precedence logic live in `packages/adapter-hermes/tests/get-turns.test.ts` (extended) and `packages/adapter-hermes/tests/send.test.ts` (extended).
- The reproduction described in the issue (`uwf thread start solve-issue -p "test"` → `uwf thread exec <tid> --agent sumeru -c 1`) succeeds end-to-end against a real hermes v0.15.1: the session is created, the message is sent, and `getTurns` returns a non-empty turn list with no `schema mismatch` error.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.

## Constraints

- The fix MUST be backward-compatible with hermes versions whose schema matches the existing v1 path (currently exercised by `tests/fixtures/hermes-session.db` per `adapter-hermes-get-turns.md`). The adapter detects schema shape at read time — it does NOT require the operator to pin a version flag.
- The adapter MUST NOT silently mask errors. JSONL parse failures of an entire file fall through to DB (a "couldn't read JSONL, try the other source" case). A successfully-read JSONL file with zero matching rows for the session is NOT an error and does NOT fall through.
- No new runtime dependencies. `node:fs/promises` and `node:sqlite` (already used by `db.ts`) cover the JSONL and DB readers respectively.
- Source-tag isolation, secret-leakage rules, and the `T | null` (no `?:`) convention from `CLAUDE.md` are preserved.
