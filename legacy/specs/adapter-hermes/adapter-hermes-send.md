---
scenario: "createHermesAdapter().send() resumes an existing Hermes session via `hermes chat -q --resume <id>`, spawns with the cwd pinned on ref.meta.cwd at create time (issue #66), and streams the new turns as SendEvents followed by a done event"
feature: adapter-hermes
tags: [adapter, hermes, send, resume, turns, streaming, cwd, issue-66]
---

## Given
- The branch `fix/53-adapter-cwd-trio` is checked out (off `main`, AFTER the streaming-adapter-contract refactor #51 merged).
- The live contract from `@sumeru/core` is `send(ref: NativeSessionRef, content: string): AsyncIterable<SendEvent>`, where `SendEvent = { type: "turn"; turn: Turn } | { type: "done"; durationMs: number; tokens: TokenUsage | null } | { type: "error"; error: Error }`. `send` is NOT a `Promise<AgentResponse>` anymore (the pre-#51 issue text describing `AgentResponse` is stale — verify against current code).
- A ref was minted by `createSession` and therefore carries `ref.meta.cwd` — a non-empty string resolved by the 5-case cwd policy in `adapter-hermes-cwd.md` (#53). For unit tests a ref may be hand-built, e.g. `{ nativeId: "20260613_120000_aaaaaa", meta: { cwd: "/srv/projects/x", sourceTag: "sumeru", model: null, createdAt: "..." } }`.
- **The #66 defect being fixed:** in the current `packages/adapter-hermes/src/adapter.ts`, the `send` path spawns the `--resume` process WITHOUT any `cwd` field — `spawnFn({ command, args, timeoutMs })` — so the child inherits the Sumeru server's `process.cwd()` and ignores `ref.meta.cwd` entirely. (This is partly because `SpawnArgs` has no `cwd` field until #53 adds it; #66 resolves naturally once #53 lands and `send` is updated to pass `cwd`.)
- The adapter already has `withRefLock(nativeId, fn)` serializing concurrent sends per `nativeId`, a `closedRefs: Set<string>`, and a JSONL-first / SQLite-fallback turns reader.
- Tests use the `makeSpawn` helper in `packages/adapter-hermes/tests/send.test.ts` (extended to capture the full `SpawnArgs`, including the new `cwd` field) plus a stubbed `turnsReader`.

## When
- The test creates an adapter with a recording `spawnFn` and a stubbed `turnsReader`, then drives a resume:
  ```typescript
  const ref = { nativeId: NATIVE, meta: { cwd: "/srv/projects/x", sourceTag: "sumeru", model: null, createdAt: "2026-06-13T12:00:00.000Z" } };
  const events: SendEvent[] = [];
  for await (const ev of adapter.send(ref, "My favorite number is 42.")) events.push(ev);
  ```
- Internally each `send`:
  1. Acquires the per-`nativeId` lock, records the highest existing turn index (high-water mark) via the turns reader.
  2. Spawns `hermes chat -q "<content>" --resume <ref.nativeId> --pass-session-id --quiet --source <sourceTag>` — model is NOT re-passed (Hermes pins it at creation) — **with `SpawnArgs.cwd` set to `ref.meta.cwd`**.
  3. Waits for exit, re-reads turns, computes the delta (index > high-water).
  4. Yields one `{ type: "turn", turn }` per delta turn (system turns filtered unless `includeSystemTurns`), then exactly one `{ type: "done", durationMs, tokens }`.

## Then
- **cwd is pinned from `ref.meta.cwd` (issue #66, the core assertion)** — the captured `SpawnArgs.cwd === "/srv/projects/x"` (i.e. exactly `ref.meta.cwd`), NOT `process.cwd()`. The resume child therefore runs in the same working directory the session was born in.
  - The value is read from `ref.meta.cwd` when it is a non-empty string; if `ref.meta.cwd` is absent/empty/non-string (e.g. a hand-built ref with `meta: {}`), the adapter falls back to `process.cwd()` so existing tests with `meta: {}` keep working.
  - There is NO per-`send` cwd parameter and NO `--cwd` CLI flag — assert `SpawnArgs.args` contains no `"--cwd"`. cwd travels solely via `child_process.spawn`'s `cwd` option (forwarded by the #53 `defaultSpawn` change).
- **Streaming shape** — `send` returns an `AsyncIterable<SendEvent>`. On success the iterable yields zero or more `{ type: "turn", turn: Turn }` (one per delta turn, ascending `index`, globally monotonic) followed by exactly one `{ type: "done", durationMs: number, tokens: TokenUsage | null }`. Because hermes is batch (not incremental), all turn events arrive in a burst after the process exits — but they are individual events, never a single array.
- **Resume works (integration)** — gated on `SUMERU_HERMES_INTEGRATION=1`: a second `send` asking "what is my favorite number?" yields an assistant turn whose `content` includes `"42"`, proving Hermes saw the prior context through the adapter.
- **Argv** — the spawned argv is `chat -q <content> --resume <nativeId> --pass-session-id --quiet --source <sourceTag>`. `--resume` is immediately followed by `ref.nativeId`. `--model` is absent on resume.
- **Delta only, no duplication** — turns yielded for a `send` are exactly those with `index >` the pre-send high-water mark. Across two sends, the union of yielded turn indices has size equal to the sum of counts (no overlap).
- **Turn shape per `@sumeru/core`** — each turn has `index: number` (absolute), `role: "user" | "assistant"` (system filtered unless `includeSystemTurns`), `content: string` (never null/undefined), `timestamp: string` (ISO-8601 UTC), `toolCalls: ToolCall[] | null` (`null`, not `[]`, when none), and `tokens: TokenUsage | null`.
- **Tool-call passthrough** — when the model used a tool, the assistant turn's `toolCalls` is a non-empty array; each `ToolCall` has `tool`, `input`, `output`, `durationMs`, `exitCode` populated from the Hermes record, none dropped or renamed.
- **`done.tokens`** — sum of input/output tokens across the yielded turns; `null` only when Hermes reported no usage for any of them. `done.durationMs` is a non-negative integer (spawn → exit wall clock).
- **Concurrent send on the same ref** — two parallel `send(ref, …)` iterations are serialized by the per-`nativeId` mutex; the second awaits the first and sees the first's turns. Neither surfaces a `409` (that is a server-layer concern; the adapter exposes no 409). The mutex behavior is UNCHANGED by #66 — adding `cwd` to the spawn args must not alter locking.
- **Send to closed session** — after `await adapter.close(ref)`, iterating `send(ref, …)` yields a single `{ type: "error", error: Error("hermes session <id> is closed") }` (or throws synchronously before the iterable, matching current behavior) and no `done`.
- **Send to never-created session** — if `nativeId` does not exist in the Hermes DB and hermes exits non-zero with a "not found" stderr, the iterable yields `{ type: "error", error }` whose message includes the id and `"not found"`, and terminates (no `done` after `error`).
- **Unicode / multiline content** — `content` is passed via argv (no shell), so embedded quotes, backslashes, newlines, and emoji round-trip without corruption. Verified with `"line1\nline2\n中文 🍊 \"quoted\""`.
- **Timeout** — `send` honors `HermesAdapterOptions.sendTimeoutMs` (default 5 min). On timeout the iterable yields `{ type: "error", error: Error("send timed out after <ms>ms") }`; turns produced before the timeout are not yielded (retrievable later via `getTurns`).
- **Non-zero exit** — a non-zero hermes exit yields `{ type: "error", error: Error("hermes exited with code <n>: <stderr tail>") }`; no partial turns.
- **No upstream mutation** — the adapter does not touch Sumeru-side `Session` state; it only shells out and reads turns.
- **Tests** under `packages/adapter-hermes/tests/send.test.ts`:
  - **New `#66` case:** a resume send with `ref.meta.cwd === "/srv/projects/x"` asserts the recorded `SpawnArgs.cwd === "/srv/projects/x"` and that `args` has no `--cwd`.
  - **New fallback case:** a ref with `meta: {}` records `SpawnArgs.cwd === process.cwd()` (keeps legacy hand-built refs green).
  - Existing argv/mutex/closed-ref/timeout/unicode cases are updated only as needed to consume `AsyncIterable<SendEvent>` and the extended `SpawnArgs`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. No `class`, no `interface`, no default exports, no optional `?:` properties added.
