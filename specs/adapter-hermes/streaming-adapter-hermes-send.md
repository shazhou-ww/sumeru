---
scenario: "adapter-hermes send() returns AsyncIterable<SendEvent> that batch-yields turns after spawn finishes, followed by a done event"
feature: adapter-hermes
tags: [adapter, hermes, streaming, send]
---

## Given
- `@sumeru/adapter-hermes` currently implements `Adapter.send` returning `Promise<AgentResponse>`.
- The hermes adapter spawns `hermes chat -q <content> --resume <id>`, waits for exit, then reads delta turns from JSONL/DB.
- Hermes CLI does NOT support incremental output; turns are only available after the process exits.
- The adapter already has `withRefLock` serializing concurrent sends per nativeId.
- `createHermesAdapter` currently calls `createSession(config: Record<string, unknown>)` which spawns hermes with an `initialQuery`.

## When
- The contributor rewrites `packages/adapter-hermes/src/adapter.ts`:
  - `createSession` accepts `SessionConfig` (from `@sumeru/core`): `{ model: string | null; cwd: string | null }`. It spawns `hermes chat -q "ping" --pass-session-id --quiet` to acquire a session id only — no user-supplied initial query. The `model` and `cwd` from `SessionConfig` are used if non-null (passed as `--model` and used for spawn cwd respectively).
  - `send(ref, content)` becomes an `async function*` (or returns a manually constructed `AsyncIterable<SendEvent>`). It spawns `hermes chat -q <content> --resume <id>`, waits for exit, reads delta turns, then yields each turn as `{ type: "turn", turn }` followed by `{ type: "done", durationMs, tokens }`.
  - On a **timeout** (`result.timedOut === true`, at `packages/adapter-hermes/src/adapter.ts:271-278`), the event array becomes `[{ type: "suspend", reason: "timeout", nativeId, elapsedMs }]` instead of an `error` event. `nativeId` is the `const nativeId = ref.nativeId` captured at send entry; `elapsedMs` is `Date.now() - startedAt` (hermes batches via `SpawnFn` and has no `exitInfo.durationMs`, so it derives elapsed from the `startedAt` timestamp recorded before the spawn).
  - On spawn failure or non-zero exit, yields `{ type: "error", error: <Error> }` and returns.
  - The `capabilities` field is removed from the returned `Adapter` object.
  - `AgentResponse` and `AdapterCapabilities` imports from `@sumeru/core` are removed.
- The contributor runs `pnpm run build && pnpm run check && pnpm run test`.

## Then
- `createHermesAdapter()` returns an `Adapter` whose `send` returns `AsyncIterable<SendEvent>`.
- `createSession` accepts `SessionConfig`. It spawns hermes to acquire a native session id. No `initialQuery` from config — the adapter uses a fixed `"ping"` prompt internally. The `cwd` from `SessionConfig` is used as spawn cwd when non-null. The `model` from `SessionConfig` is passed as `--model` when non-null.
- On a successful `send` call:
  - The iterable yields zero or more `{ type: "turn", turn: Turn }` events (one per delta turn, in order, with globally monotonic indices).
  - After all turn events, yields exactly one `{ type: "done", durationMs: number, tokens: TokenUsage | null }`.
  - Because hermes is batch (not incremental), all turns are yielded in a burst after the process exits, but they are individual events — NOT a single array.
- On a **send timeout** (`result.timedOut === true`):
  - The iterable yields exactly one `{ type: "suspend", reason: "timeout", nativeId, elapsedMs }` as its **last** event and terminates — NO `error`, NO `done`. `nativeId` is `ref.nativeId`; `elapsedMs` is `Date.now() - startedAt` (a number). The hermes process is still killed by the spawn timer (suspend is a checkpoint, not a freeze).
- On a **failed `send`** (spawn failure or non-zero exit):
  - The iterable yields `{ type: "error", error: Error }` and terminates (no `done` after `error`).
- The timeout unit test in `packages/adapter-hermes/tests/send.test.ts` (formerly "yields error event on timeout") asserts `event.type === "suspend"` with `reason === "timeout"`, a non-empty `nativeId`, and numeric `elapsedMs`.
- The `withRefLock` mechanism continues to serialize concurrent sends per nativeId.
- The returned adapter object has NO `capabilities` field.
- Existing tests in `packages/adapter-hermes/tests/` are updated to consume `AsyncIterable<SendEvent>` (e.g. using `for await`).
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
- A `.changeset/<slug>.md` declares `@sumeru/adapter-hermes` as a `major` bump.
