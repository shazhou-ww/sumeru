---
scenario: "createClaudeCodeAdapter().createSession honors a per-call config.cwd, spawns claude with that cwd, and records it on NativeSessionRef.meta — overriding the constructor default; non-string cwd is rejected"
feature: adapter-claude-code
tags: [adapter, claude-code, cwd, workspace-root, spawn, issue-54]
---

## Given
- The branch `fix/53-adapter-cwd-trio` is checked out (off `main`, AFTER the streaming-adapter-contract refactor #51 merged).
- The live adapter contract from `@sumeru/core` is: `createSession(config: SessionConfig): Promise<NativeSessionRef>` where `SessionConfig = { model: string | null; cwd: string | null }`. There is NO `initialQuery` field — `createSession` always uses the fixed `"ping"` prompt internally. (Do not trust the pre-#51 issue text that mentions `initialQuery` / `Record<string, unknown>`; verify against the current code.)
- `@sumeru/adapter-claude-code` already accepts a constructor option `cwd: string | null` and already resolves a per-call cwd. Current state to be verified/completed:
  - `packages/adapter-claude-code/src/adapter.ts` — `resolveCwd()` returns `options.cwd ?? process.cwd()`. `createSession` computes `spawnCwd = config.cwd !== null && config.cwd.length > 0 ? config.cwd : resolveCwd()`, passes it to `runClaude`, and writes `meta.cwd = spawnCwd`. So Cases 1, 2, 3, and 5 are ALREADY satisfied and must be asserted to stay green.
  - **The one real gap (Case 4):** there is currently NO type-validation — a non-string `config.cwd` (e.g. `42`) is neither rejected nor `.length`-guarded reliably; it must be made to reject with a descriptive `Error` BEFORE any spawn. This is the behavior change #54 requires.
  - `packages/adapter-claude-code/src/types.ts` — `SpawnArgs` already has `{ command; args; timeoutMs; cwd }`. `packages/adapter-claude-code/src/spawn.ts` already forwards `cwd` to `child_process.spawn`. No type/spawn changes are needed on this adapter.
- Tests use the existing `fakeSpawn` helper from `packages/adapter-claude-code/tests/test-utils.ts`, which records each `SpawnArgs` (`{ command, args, timeoutMs, cwd }`) into a `calls` array.

## When
- Test code creates an adapter and calls `createSession` with five shapes. Each call passes a full `SessionConfig` whose `cwd` is the value under test:
  1. `const { spawnFn: mock } = fakeSpawn({ stdout: buildNdjson({ sessionId: "...-1" }) });`
     `const a = createClaudeCodeAdapter({ cwd: "/opt/default", spawnFn: mock });`
     `await a.createSession({ model: null, cwd: "/srv/projects/x" });`            // per-call cwd present
  2. `const b = createClaudeCodeAdapter({ cwd: "/opt/default", spawnFn: mock });`
     `await b.createSession({ model: null, cwd: null });`                           // no per-call cwd
  3. `const c = createClaudeCodeAdapter({ spawnFn: mock });`
     `await c.createSession({ model: null, cwd: null });`                           // no constructor cwd, no per-call cwd
  4. `const d = createClaudeCodeAdapter({ spawnFn: mock });`
     `await d.createSession({ model: null, cwd: 42 as unknown as string });`        // wrong type
  5. `const e = createClaudeCodeAdapter({ spawnFn: mock });`
     `await e.createSession({ model: null, cwd: "" });`                              // empty string
- Each `mock` returns the canned stream-json output from `adapter-claude-code-create-session.md` (a `system` line with a session id, a single assistant turn, a `result` line, exit 0).
- A follow-up `send` is exercised on the ref returned by case 1: the resulting `AsyncIterable<SendEvent>` is drained, and the `mock` records the spawn args of the `--resume` call.

## Then
- **Case 1 (per-call cwd wins)** — the captured `SpawnArgs.cwd === "/srv/projects/x"`. The constructor's `/opt/default` is ignored. The returned `ref.meta.cwd === "/srv/projects/x"`.
- **Case 2 (constructor default applies)** — `SpawnArgs.cwd === "/opt/default"`. `ref.meta.cwd === "/opt/default"`. (Pre-existing behavior, asserted to stay green.)
- **Case 3 (no cwd configured anywhere)** — `SpawnArgs.cwd === process.cwd()` at call time. `ref.meta.cwd === process.cwd()`. (Pre-existing behavior, asserted to stay green.)
- **Case 4 (`config.cwd` is not a string) — THE behavior change** — `createSession` rejects with an `Error` whose `.message` includes BOTH the literal substring `"cwd"` AND the phrase `"must be a string"`. The mock `spawnFn` is **not** invoked (assert `calls.length === 0`). No `NativeSessionRef` is returned. The guard is `config.cwd !== null && typeof config.cwd !== "string"` — `null` is "absent" (legal), only a non-null non-string value rejects. It runs BEFORE the empty-string/resolveCwd computation.
- **Case 5 (`config.cwd` is the empty string)** — Treated as "no per-call cwd" (mirrors the server-side resolver's empty-string handling). Falls through to the constructor cwd (`/opt/default` if present, else `process.cwd()`). The spawn is **not** rejected. For adapter `e` (no constructor cwd): `SpawnArgs.cwd === process.cwd()` and `ref.meta.cwd === process.cwd()`.
- **`send` honours the ref-pinned cwd** — the follow-up `send` in case 1 spawns `claude --resume <id> ...` with `SpawnArgs.cwd === "/srv/projects/x"` (the value pinned at create time on `ref.meta.cwd`; the send path already reads `ref.meta.cwd` when it is a non-empty string, falling back to `resolveCwd()` otherwise). Per-`send` `cwd` arguments are NOT supported — a session pins cwd at birth.
- **No `--cwd` CLI flag** — the adapter sets cwd via `child_process.spawn`'s `cwd` option only. `SpawnArgs.args` does NOT contain a `--cwd` segment (CC has no such flag). Asserted by inspecting `SpawnArgs.args`.
- **`meta` shape unchanged otherwise** — `ref.meta` still has exactly the keys `cwd`, `model`, `createdAt`, `subtype`. No new keys from this issue. The change is value-only (Cases 1–3,5) plus a new rejection path (Case 4); existing tests that snapshot `ref.meta` keys continue to pass.
- **Argv hygiene preserved** — passing `cwd: "/path with spaces/中文/🍊"` works: the spawn captures the exact string verbatim, no shell interpolation, no escaping.
- **Tests** — `packages/adapter-claude-code/tests/create-session.test.ts` gains the five cases above (the existing `uses options.cwd when provided` test is the Case-2 seed and stays). `send.test.ts` gains one case asserting the follow-up resume spawn uses the ref-pinned cwd. The opt-in integration test (`SUMERU_CLAUDE_CODE_INTEGRATION=1`) gains a smoke check that runs `claude` from a temp dir and asserts the working-directory side effect.
- **Symmetry with adapter-hermes** — the rules above are byte-identical to `adapter-hermes-cwd.md`. The two adapters share one cwd resolution policy so the server relies on a single contract regardless of which adapter is wired.
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit 0. No `class`, no `interface`, no default exports, no optional `?:` properties added.
