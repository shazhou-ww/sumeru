---
scenario: "End-to-end: a real Hermes session created and exchanged via Sumeru — POST creates session, two POST .../messages roundtrips with resume context, DELETE closes; recordings are reproducible against a live local Hermes"
feature: server-http
tags: [e2e, integration, hermes, sse, resume, session, phase-3, completion-criteria]
---

## Given
- A live `hermes` binary is on `$PATH` (real, not stubbed) with valid credentials. The integration test is gated on `process.env.SUMERU_HERMES_INTEGRATION === "1"` and is skipped otherwise.
- The model used is `anthropic/claude-haiku-4` (fast, deterministic enough for the assertions below — but assertions use **substring contains**, not exact equality, to absorb minor model variance).
- A fixture config `tests/fixtures/sumeru.hermes-only.yaml` exists:
  ```yaml
  name: sumeru@e2e-test
  gateways:
    hermes:
      adapter: hermes
      capabilities: { resume: true, streaming: false }
  ```
- The server is launched: `sumeru start --port 0 --config tests/fixtures/sumeru.hermes-only.yaml`. The CLI auto-loads `@sumeru/adapter-hermes` (per `server-adapter-integration.md`).
- The client is a small TypeScript test helper (built on `node:http` or `undici`) that can:
  - Issue plain JSON requests.
  - Issue SSE GET/POST and parse `event: ...`, `data: ...`, `id: ...` records into an array of `{ id, event, data }`.
  - Optionally drop the connection after seeing event id `<n>` and reconnect with `Last-Event-ID: <n>`.

## When
- The full sequence (each step must complete before the next begins):
  1. `POST /gateways/hermes/sessions` with body `{"config":{"model":"anthropic/claude-haiku-4","systemPrompt":"You are a brevity bot. Answer in one short sentence."}}` → record `ses_<X>`.
  2. `POST /gateways/hermes/sessions/ses_<X>/messages` with body `{"content":"My favorite number is 42. Acknowledge it briefly."}`, parse SSE → record events as `stream1`.
  3. `POST /gateways/hermes/sessions/ses_<X>/messages` with body `{"content":"What is my favorite number? Reply with just the digits."}`, parse SSE → record events as `stream2`.
  4. `POST /gateways/hermes/sessions/ses_<X>/messages` with body `{"content":"List the integers from 1 to 5 separated by spaces."}` — but drop the connection after the first `event: turn` (or after 2 s, whichever first). Sleep 1 s.
  5. Reconnect: `POST /gateways/hermes/sessions/ses_<X>/messages` with the same body **and** `Last-Event-ID: <last_id_from_step_4>` → record events as `stream3-resumed`.
  6. `GET /gateways/hermes/sessions/ses_<X>` → record session detail.
  7. `DELETE /gateways/hermes/sessions/ses_<X>` → record status.
  8. `GET /gateways/hermes/sessions/ses_<X>` → record post-close session detail.

## Then
- **Step 1 — session created** —
  - HTTP 201, `value.id` matches `^ses_[0-9A-HJKMNP-TV-Z]{26}$`, `value.status === "idle"`, `value.config.model === "anthropic/claude-haiku-4"`. (Per `server-session-create-endpoint.md`, unchanged.)
  - `hermes sessions list --source sumeru` (run in test harness) lists exactly one session created within the last 10 s. Its native ID is mapped to `ses_<X>` in the server's internal store.
- **Step 2 — first message stream (stream1)** —
  - Stream ends with exactly one `event: done`.
  - At least two `event: turn` records: the first has `value.role === "user"` and `value.content === "My favorite number is 42. Acknowledge it briefly."`; at least one subsequent has `value.role === "assistant"`.
  - Event ids are `1, 2, …` strictly increasing without gaps (modulo heartbeats, which also increment the counter).
  - Each `event: turn` has `data` parseable as JSON, with top-level keys `type === "@sumeru/turn"` and a `value` object whose keys match `Turn` from `@sumeru/core` (`index`, `role`, `content`, `timestamp`, `toolCalls`, optional `tokens`).
  - The `event: done`'s `data.value.turnCount` equals the count of `event: turn` records emitted in stream1.
- **Step 3 — second message stream (stream2) — RESUME WORKS (first completion criterion)** —
  - At least one `event: turn` has `value.role === "assistant"` and `value.content` contains the substring `"42"`. This is the canonical proof that Hermes resume works through the adapter.
  - The user turn from stream1 (`"My favorite number is 42…"`) does NOT reappear in stream2 (no duplicates across streams).
  - All assistant turns in stream2 have `value.index` strictly greater than every `value.index` in stream1 (the indices are session-global).
- **Steps 4 & 5 — disconnect-and-resume (second completion criterion: 断连重连能从上次位置继续)** —
  - The merged set of events (`stream3-broken-events ∪ stream3-resumed-events`) contains every event id from `1` up to the final `event: done`'s id, with NO duplicates and NO missing ids.
  - The `event: done` is in `stream3-resumed`, NOT in `stream3-broken`.
  - `hermes sessions list --source sumeru` still shows exactly one matching session (no second session was inadvertently created by the resume).
  - The Sumeru server logs do NOT contain a second `adapter.send` invocation for this logical send — the resume reuses the in-flight buffer.
  - The final `event: done`'s `value.turnCount` equals the count of unique `event: turn` records across both connection attempts.
- **Step 6 — session detail before close** —
  - HTTP 200, `value.status === "idle"` (no in-flight send by the time we ask), `value.config` byte-identical to the original POST body's config field.
- **Step 7 — DELETE returns 204** —
  - HTTP 204, no body. The server invoked `adapter.close(nativeRef)` exactly once (verified by adapter instrumentation in tests, or by absence of subsequent operations on that nativeRef).
- **Step 8 — session detail after close** —
  - HTTP 200, `value.status === "closed"`, all other fields unchanged from Step 6.
- **Tool calls are observable (third part of "完成标准: 含 toolCalls")** — A separate sub-test in this file (or sibling `e2e-tool-calls.test.ts`) sends `{"content":"Use the terminal tool to run `echo hi`, then tell me what it printed."}`. The resulting stream contains at least one `event: turn` whose `value.toolCalls` is a non-empty array; the first `toolCalls[0].tool === "terminal"`, `toolCalls[0].output` contains `"hi"`. The full ToolCall shape from `@sumeru/core` is preserved in the wire JSON (no field renamed, no field dropped, no field omitted).
- **No native ID leakage** — Across every response body in the entire test run (Steps 1–8 plus the tool-call sub-test), no string matching `/^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/` appears. The native Hermes session ID is invisible to HTTP clients.
- **Cleanup** — After Step 7, the test harness invokes `hermes sessions delete <native-id>` to remove the session row from the local Hermes DB so test runs are reproducible. Server-side: `sessions.list("hermes")` includes the closed session entry until process exit (Phase-3 does NOT prune closed sessions from the in-memory store; consistent with `server-session-delete-endpoint.md`).
- **Test runtime budget** — The full integration test must complete in under 90 s on a developer laptop. If it exceeds that, the suite fails fast (`vitest --testTimeout=90000`).
- **Skip behavior in CI** — When `SUMERU_HERMES_INTEGRATION` is unset, every assertion above is replaced by a single skipped test stub (Vitest `it.skipIf`), so the default `pnpm run test` does NOT require a working Hermes installation.
- All previous Phase-1, Phase-2, and Phase-3 unit tests continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0 in the no-integration default mode.
