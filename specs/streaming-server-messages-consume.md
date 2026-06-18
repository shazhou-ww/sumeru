---
scenario: "server messages.ts consumes AsyncIterable<SendEvent> from adapter.send, emitting each turn event as an SSE event as it arrives"
feature: server-messages
tags: [server, sse, streaming, messages]
---

## Given
- `packages/server/src/sse/messages.ts` currently calls `response = await adapterByName.send(nativeRef, body.value.content)` which returns `Promise<AgentResponse>`.
- After the await, it iterates `response.turns` synchronously, writes each turn to ocas, indexes for FTS5, persists to turn-list, and emits an SSE `turn` event.
- Heartbeats run on a timer during the await, then are cleared.
- The `done` SSE event is emitted after all turns are processed.
- `AgentResponse` is imported from `@sumeru/core`.

## When
- The contributor rewrites the adapter invocation section of `handleMessageEndpoint` in `packages/server/src/sse/messages.ts`:
  - Replace `const response: AgentResponse = await adapterByName.send(...)` with `for await (const event of adapterByName.send(nativeRef, body.value.content))`.
  - Inside the loop, switch on `event.type`:
    - `"turn"`: record the turn to ocas, index for FTS5, persist turn hash, emit SSE `turn` event — same logic as current synchronous loop but executed incrementally as each turn arrives.
    - `"done"`: emit SSE `done` event with `{ turnCount, tokens, durationMs }`. Stop heartbeats. Mark session idle. Finish buffer and end response.
    - `"error"`: emit SSE `error` event. Stop heartbeats. Mark session idle. Finish buffer and end response.
  - Heartbeats continue running during the `for await` loop (not cleared until `done` or `error`).
  - Remove the `AgentResponse` import from `@sumeru/core`. Import `SendEvent` if needed for type annotation.
  - Remove any references to `AdapterCapabilities`.
- The contributor runs `pnpm run build && pnpm run check && pnpm run test`.

## Then
- The message endpoint consumes `adapter.send()` as an async iterable, NOT as a promise.
- Each `turn` event from the adapter is:
  1. Recorded to ocas (via `recordPayload`).
  2. Indexed for FTS5 search.
  3. Persisted to the session's turn-list (via `sessions.appendTurnHash`).
  4. Emitted as an SSE `turn` event on the response stream.
  — All four steps happen incrementally per turn, as the adapter yields it, BEFORE the agent process has necessarily exited.
- If any turn fails ocas recording, FTS5 indexing, or turn-list persistence, the server emits an SSE `error` event and terminates the stream — same error surface as before, but now mid-stream rather than post-batch.
- The `done` event from the adapter triggers: emit SSE `done` event, clear heartbeat timer, mark session idle, finish buffer, end response.
- The `error` event from the adapter triggers: emit SSE `error` event, clear heartbeat timer, mark session idle, finish buffer, end response.
- Heartbeats continue to fire during the `for await` loop — they are NOT cleared until the final `done` or `error` event.
- The `AgentResponse` type is no longer imported in `messages.ts`.
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
- A `.changeset/<slug>.md` declares `@sumeru/server` as a `major` bump.
