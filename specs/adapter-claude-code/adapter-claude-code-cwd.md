---
scenario: "createClaudeCodeAdapter().createSession honors a per-call config.cwd, spawns claude with that cwd, and records it on NativeSessionRef.meta — overriding the constructor default"
feature: adapter-claude-code
tags: [adapter, claude-code, cwd, workspace-root, spawn, phase-6, issue-27]
---

## Given
- The branch `fix/27-workspace-root-session-cwd` is checked out.
- `@sumeru/adapter-claude-code` already accepts a constructor option `cwd: string | null` (the default applied to every spawn when no per-call cwd is provided). That behavior is unchanged.
- Today the adapter resolves `cwd` from `options.cwd ?? process.cwd()` for every call, ignoring `config.cwd`. Issue #27 makes per-call `config.cwd` win.
- The adapter contract continues to have `createSession(config: Record<string, unknown>): Promise<NativeSessionRef>` — no signature change. The `cwd` is sourced from the opaque config blob.
- Tests use the existing `mockSpawnFn` helper from `packages/adapter-claude-code/tests/test-utils.ts` to capture the `SpawnArgs` (`{ command, args, timeoutMs, cwd }`) passed to the adapter's `spawnFn`.

## When
- Test code creates an adapter and calls `createSession` with three shapes:
  1. `const a = createClaudeCodeAdapter({ cwd: "/opt/default", spawnFn: mock });`
     `await a.createSession({ initialQuery: "hi", cwd: "/srv/projects/x" });`
  2. `const b = createClaudeCodeAdapter({ cwd: "/opt/default", spawnFn: mock });`
     `await b.createSession({ initialQuery: "hi" });`  // no per-call cwd
  3. `const c = createClaudeCodeAdapter({ spawnFn: mock });`
     `await c.createSession({ initialQuery: "hi" });`  // no constructor cwd, no per-call cwd
  4. `const d = createClaudeCodeAdapter({ spawnFn: mock });`
     `await d.createSession({ initialQuery: "hi", cwd: 42 });`  // wrong type
  5. `const e = createClaudeCodeAdapter({ spawnFn: mock });`
     `await e.createSession({ initialQuery: "hi", cwd: "" });`  // empty string
- Each `mock` returns the canned stream-json output documented in `adapter-claude-code-create-session.md` (a `system` line with a UUID session id, a single assistant `result`, exit 0).
- A follow-up `send` is called on the ref returned by case 1: `await a.send(ref, "do thing")`. The mock again records the spawn args.

## Then
- **Case 1 (per-call cwd wins)** — the captured `SpawnArgs.cwd === "/srv/projects/x"`. The constructor's `/opt/default` is ignored. The returned `ref.meta.cwd === "/srv/projects/x"`.
- **Case 2 (constructor default applies)** — `SpawnArgs.cwd === "/opt/default"`. `ref.meta.cwd === "/opt/default"`. (Pre-existing behavior, asserted to stay green.)
- **Case 3 (no cwd configured anywhere)** — `SpawnArgs.cwd === process.cwd()` at call time. `ref.meta.cwd === process.cwd()`. (Pre-existing behavior, asserted to stay green.)
- **Case 4 (`config.cwd` is not a string)** — `createSession` rejects with an `Error` whose `.message` includes the literal `"cwd"` and the phrase `"must be a string"`. The mock spawnFn is **not** invoked (no process is spawned for an invalid cwd). No NativeSessionRef is returned.
- **Case 5 (`config.cwd` is the empty string)** — Treated as "no per-call cwd" (mirrors the server-side resolver's empty-string handling). Falls through to the constructor cwd (`/opt/default` if present, else `process.cwd()`). The spawn is **not** rejected.
- **`send` honours the ref-pinned cwd** — the follow-up `send` in case 1 spawns `claude --resume <id> ...` with `SpawnArgs.cwd === "/srv/projects/x"` (i.e. the value pinned at create time on `ref.meta.cwd`). Per-`send` `cwd` arguments are NOT supported (the contract is "session pins cwd at birth"), so callers cannot move a session's cwd mid-life.
- **No `--cwd` CLI flag** — the adapter continues to set cwd via `child_process.spawn`'s `cwd` option only. `args` does NOT contain a `--cwd` segment (CC has no such flag). This is asserted by inspecting `SpawnArgs.args`.
- **`meta` shape unchanged otherwise** — `ref.meta` still has exactly the keys `cwd`, `model`, `createdAt`, `subtype`. No new keys from this issue. (The change is value-only — existing tests that snapshot `ref.meta.keys` continue to pass.)
- **Argv hygiene preserved** — passing `cwd: "/path with spaces/中文/🍊"` works: the spawn captures the exact string verbatim, no shell interpolation, no escaping.
- **Tests** — `packages/adapter-claude-code/tests/create-session.test.ts` gains five new cases covering 1–5 above, plus one `send.test.ts` case for the follow-up resume cwd. The opt-in integration test (`SUMERU_CLAUDE_CODE_INTEGRATION=1`) gains a smoke check that runs `claude` from a temp dir and asserts the working-directory side effect (e.g. by passing an `initialQuery` like `"print pwd"` and grepping the output).
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit 0. No `class`, no `interface`, no default exports, no optional `?:` properties added.
