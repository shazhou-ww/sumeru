---
scenario: "Each user/assistant turn produced by POST .../messages is written to ocas, and the turn's hash appears inside the SSE event's value"
feature: server-ocas
tags: [ocas, turn, sse, recording, hash, phase-4]
---

## Given
- Phase-4 bootstrap is in place (`server-ocas-store-bootstrap.md`, `server-ocas-schemas.md`).
- Session-meta is recorded on create per `server-ocas-session-meta.md`.
- `POST /gateways/:name/sessions/:id/messages` is the SSE endpoint speccd in Phase 3 (`server-message-sse-endpoint.md`); behavior on the wire is the SAME EXCEPT for the `value` of `event: turn` records (see below).
- `Turn` from `@sumeru/core` is unchanged. The SSE wire `Turn` already had a `hash` field shown in the architecture spec example; Phase 3 emitted it as undefined / absent. Phase 4 makes it canonical.

## When
- An idle session `ses_<X>` exists on `hermes` (created via `POST .../sessions`, see `server-ocas-session-meta.md`).
- The client sends:
  ```
  POST /gateways/hermes/sessions/ses_<X>/messages
  Content-Type: application/json

  {"content": "Say hi in one word."}
  ```
- The stubbed adapter's `send` returns an `AgentResponse` with two assistant turns:
  - Turn A: `{ index: 1, role: "assistant", content: "Looking…", timestamp: "<iso-A>", toolCalls: [{tool:"terminal",input:{cmd:"ls"},output:"a\nb",durationMs:50,exitCode:0}], tokens: { input: 100, output: 20 } }`
  - Turn B: `{ index: 2, role: "assistant", content: "Hi.",         timestamp: "<iso-B>", toolCalls: null,                                                                                                  tokens: { input: 110, output: 4  } }`

## Then
- **User-turn write — happens FIRST** —
  - Before invoking `adapter.send`, the server constructs the user turn:
    ```json
    {
      "index": <next index, starting at 0 for an empty session>,
      "role": "user",
      "content": "Say hi in one word.",
      "timestamp": "<iso-now>",
      "toolCalls": null
    }
    ```
    Note: `tokens` is OMITTED (per schema: optional).
  - `store.put(SUMERU_TURN_SCHEMA_HASH, <user-turn-payload>)` is called; the returned hash is appended to `Session.turnHashes` (in-memory).
  - This write MUST succeed before the SSE stream is opened. If it throws, the server returns `500 ocas_write_failed` (NOT SSE — the stream has not yet started; it's still safe to return JSON). The session is flipped back to `idle` (the user turn was never accepted).
- **Assistant-turn writes — one per turn from the adapter** —
  - For each turn the adapter produced (in order): the server `store.put`s a `@sumeru/turn` payload identical to the `Turn` value (the schema accepts it as-is). The payload's `index` matches `Turn.index`, which the adapter sets as `<user-turn-index> + i + 1`.
  - The returned hash is appended to `Session.turnHashes` AND embedded in the SSE event:
    ```
    id: <n>
    event: turn
    data: {"type":"@sumeru/turn","value":{"index":1,"role":"assistant","content":"Looking…","timestamp":"<iso-A>","toolCalls":[…],"tokens":{"input":100,"output":20},"hash":"<13-char-hash>"}}

    ```
    `value.hash` is the freshly computed turn hash — clients can fetch the canonical record via `GET /ocas/<hash>`.
  - The `hash` field is added by the server BEFORE serializing the SSE `data` line; the adapter does not need to compute hashes. The hash is NOT stored INSIDE the ocas payload — it is computed FROM the payload, so embedding it would be circular. The schema (`server-ocas-schemas.md`) does NOT include `hash` in the required/properties list.
- **`Turn` type adjustment in `@sumeru/core`** — Add a `hash: string | null` field. `null` is the value the adapter produces; the server replaces it with the computed hash before emitting the SSE event. (This keeps `@sumeru/core.Turn` compatible with adapters that don't know about ocas.)
- **Done event includes turn count** — The `event: done` summary still reports `turnCount` as **the number of `event: turn` records emitted in this stream** (i.e. assistant turns from this `send`, NOT including the prior user turn). This matches Phase-3 semantics. `Session.turnHashes` length on the server side increases by `1 + assistantTurnCount` (user + assistants).
- **Adapter failure path** —
  - The user turn IS written before `adapter.send` is invoked (the user did issue the request). The session has 1 new turn even on adapter error.
  - `event: error` is emitted as in Phase 3; no assistant turns are recorded.
  - Tests: `Session.turnHashes` length = preTurnCount + 1 after a failed send.
- **Heartbeat / done events** — Phase-3 wire format unchanged. Heartbeats and done events are NEITHER written to ocas NOR carry an ocas hash — they are ephemeral protocol frames, not recordings. Only `event: turn` and `event: error` payloads MAY persist; in Phase 4, errors are not persisted (see below).
- **Errors persistence** — `event: error` payloads are NOT written to ocas in Phase 4. (A `@sumeru/turn-error` schema may land in a future phase; not in this issue.)
- **Resume path** (`Last-Event-ID` header) — Resume is a pure SSE buffer replay (Phase 3 contract). The buffered events already contain the `hash` field from the first send, so resumed clients see the same hash. Resume does NOT re-write to ocas.
- **Concurrent send rejection (409)** — If a second concurrent `POST` is rejected with 409, NO turn (user or assistant) is written. Writing happens only after `tryActivate` succeeds.
- **Validation enforcement** — The user turn payload is validated by `@ocas/core`'s schema validator on `put`. A test stubs the adapter to return an assistant turn with `tokens.input = -1`; the `put` for that turn rejects with `SchemaValidationError`. The server then emits `event: error` (`adapter_returned_invalid_turn`) instead of `event: turn` for that record, drops remaining turns, and ends the stream. Subsequent assistant turns are NOT written.
- **Hash determinism** — Two distinct sends that produce byte-identical user turns (same `content`, but different `timestamp`) yield DIFFERENT hashes (timestamp differs). The hash is a function of the full payload — including timestamp — so accidental dedup of distinct turns does NOT occur.
- **Tests** under `packages/server/tests/ocas-turn-recording.test.ts`:
  - Send one assistant turn → after stream end, `store.listByType(SUMERU_TURN_SCHEMA_HASH).length` increased by exactly `2` (1 user + 1 assistant).
  - The user turn payload (decoded from ocas) has `role: "user"`, `toolCalls: null`, and matches the request `content`.
  - The assistant turn payload (decoded) is byte-equal to the adapter's `Turn` (minus the server-injected `hash`).
  - The SSE `event: turn` data parses to a value with `hash` matching `^[0-9A-HJKMNP-TV-Z]{13}$`, and `GET /ocas/<that-hash>` returns the canonical turn (envelope contract in `server-ocas-object-endpoint.md`).
  - Adapter rejection: 1 user turn recorded, 0 assistant turns.
  - Adapter returns invalid turn (negative tokens) → `event: error` `adapter_returned_invalid_turn` emitted, partial turns up to that point recorded, no further turns recorded.
  - Concurrent 409: store size unchanged after the rejected request.
  - Closed session: `POST .../messages` 404, no ocas write.
  - User turn write failure (mocked `put` throws on the FIRST call) → HTTP `500 ocas_write_failed`, session flipped back to idle, store unchanged.
- All Phase-3 tests continue to pass; their stubbed adapter response now flows through the recording path. SSE wire format is unchanged except for the appearance of `value.hash` on `event: turn` (Phase-3 tests must accept the new field — update assertions to allow it).
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
