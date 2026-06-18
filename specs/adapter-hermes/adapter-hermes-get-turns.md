---
scenario: "createHermesAdapter().getTurns() reads the full ordered turn history of a Hermes session from the SQLite DB and returns it as @sumeru/core Turn[]"
feature: adapter-hermes
tags: [adapter, hermes, get-turns, sqlite, history, phase-3]
---

## Given
- `@sumeru/adapter-hermes` is built. The adapter has `node:better-sqlite3` (or `bun:sqlite` / `node:sqlite` depending on Node version — see Constraints below) as a runtime dependency for read-only access to `~/.hermes/sessions.db`.
- The Hermes session DB schema is treated as **read-only**, observed at adapter version time. The adapter pins the table/column names it reads (e.g. `messages` table with `session_id, idx, role, content, timestamp, tool_calls_json, tokens_in, tokens_out`) and is unit-tested against a fixture DB.
- A test fixture `tests/fixtures/hermes-session.db` ships with the adapter package — a tiny SQLite DB with two known sessions, each containing a deterministic turn sequence (no real model calls).
- The default Hermes session DB path is `~/.hermes/sessions.db`; configurable via `HermesAdapterOptions.dbPath`.

## When
- After Phase 3 send tests, the test calls:
  ```typescript
  const turns = await adapter.getTurns(ref);
  ```
- The adapter:
  1. Resolves the DB path from options or `~/.hermes/sessions.db`.
  2. Opens the DB **read-only** (`fileMustExist: true`, `readonly: true`).
  3. Issues a parameterized query `SELECT idx, role, content, timestamp, tool_calls_json, tokens_in, tokens_out FROM messages WHERE session_id = ? ORDER BY idx ASC` (column names are the **adapter's own internal mapping**; if Hermes renames columns, the adapter's mapping table is the only place that changes).
  4. Maps each row to a `Turn` with the shape from `@sumeru/core`.
  5. Closes the DB handle before returning.

## Then
- **Order** — `turns` is sorted by `index` ascending. The first turn has the lowest `index` in the session (typically `0` but the adapter does NOT renumber — it preserves Hermes's own indices).
- **Length & roles** — A freshly-created session that has only had one `send(content="hi")` call returns at least 2 turns: one `role: "user"` (`content: "hi"`) and one `role: "assistant"`. System turns are excluded by default (matches `send` semantics).
- **Tool calls round-trip** — Rows whose `tool_calls_json` is non-null parse into a `ToolCall[]` with every field (`tool`, `input`, `output`, `durationMs`, `exitCode`) populated. Rows with null `tool_calls_json` produce `toolCalls: null` (NOT `[]`).
- **Token usage round-trip** — `tokens_in` and `tokens_out` map to `tokens: { input: number; output: number }`. Rows with both NULL produce `tokens: undefined` (matching the existing `Turn.tokens?` optionality in `@sumeru/core`); rows with one NULL produce that field as `0`.
- **Timestamps** — `timestamp` is normalized to ISO-8601 UTC ending in `Z`. (Hermes stores epoch-millis or local ISO depending on version; the adapter coerces.)
- **Empty / missing session** — Calling `getTurns(ref)` on a `ref.nativeId` that does not exist in the DB resolves to `[]` (empty array) — NOT an error. Rationale: the server may legitimately call `getTurns` on a session whose Hermes row was pruned externally.
- **Read-only** — The DB handle is opened read-only; an attempt by the adapter to write fails at SQLite level (verified by a unit test that monkey-patches the query function and asserts no `INSERT|UPDATE|DELETE` SQL is ever issued).
- **No leakage of secret material** — The adapter does NOT read `auth.json`, `.env`, or any other Hermes file. It reads `sessions.db` only.
- **Concurrent reads are safe** — Two parallel `getTurns(refA)` and `getTurns(refB)` calls succeed without locking each other.
- **DB missing** — If the DB file does not exist, `getTurns` rejects with `Error("hermes session DB not found at <path>")` — NOT an empty array, because that would mask a misconfiguration.
- **DB corrupt** — If the DB file exists but is not a valid SQLite file, `getTurns` rejects with `Error("hermes session DB is unreadable: <detail>")`.
- **Schema drift detection** — If a required column is missing (e.g. Hermes renamed `idx` to `seq` in a future version), `getTurns` rejects with `Error("hermes session DB schema mismatch: missing column 'idx' in table 'messages' (adapter pinned to schema v1)")`. The adapter has a small `SCHEMA_VERSION = 1` constant that the test suite asserts is mentioned in the error.
- **Tests** under `packages/adapter-hermes/tests/get-turns.test.ts`:
  - Reads the fixture DB and asserts the exact `Turn[]` for both sessions.
  - Round-trips a turn with a tool call (assert `toolCalls[0].tool === "terminal"`, etc.).
  - Returns `[]` for an unknown `nativeId`.
  - Rejects on missing DB path.
  - Rejects on schema mismatch (using a second fixture DB with a renamed column).
  - One opt-in integration test (`SUMERU_HERMES_INTEGRATION=1`) reads the live `~/.hermes/sessions.db`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.

## Constraints
- The adapter MUST work on Node 22. If `better-sqlite3` is not viable, the adapter falls back to `node:sqlite` (Node 22+ stable). The choice is internal — the public API does NOT expose a SQLite driver type.
- The adapter MUST NOT spawn `hermes sessions export` for `getTurns` — that path is too slow (it produces a full JSONL with system prompt) and wraps stdout in a way that is fragile to parse. Direct SQLite read is the chosen mechanism.
