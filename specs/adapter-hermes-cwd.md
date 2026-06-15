---
scenario: "createHermesAdapter().createSession honors a per-call config.cwd, spawns hermes with that cwd, and records it on NativeSessionRef.meta — overriding the default of process.cwd()"
feature: adapter-hermes
tags: [adapter, hermes, cwd, workspace-root, spawn, phase-6, issue-27]
---

## Given
- The branch `fix/27-workspace-root-session-cwd` is checked out.
- `@sumeru/adapter-hermes` today does NOT accept a constructor `cwd` option and does NOT pass any explicit `cwd` to `child_process.spawn` — it inherits `process.cwd()` of the Sumeru server process. `meta.cwd` is set to `process.cwd()` at call time.
- Issue #27 changes both surfaces to mirror `adapter-claude-code`:
  1. `HermesAdapterOptions` gains a `cwd: string | null` field (constructor default).
  2. `createSession` reads `config.cwd` from the per-call opaque config and uses it (when present) as the `child_process.spawn` `cwd`.
  3. The `SpawnArgs` test seam type in `packages/adapter-hermes/src/types.ts` gains a `cwd: string` field, matching `adapter-claude-code`'s shape, so production and tests share one signature.
- The default `defaultSpawn` in `packages/adapter-hermes/src/spawn.ts` is updated to forward the new `cwd` field to `child_process.spawn`. Any existing call site that does not pass `cwd` defaults it to `process.cwd()` for backward compatibility — no caller breaks.
- Tests use the existing `mockSpawn` helper from `packages/adapter-hermes/tests/create-session.test.ts` (extended to capture the new `cwd` arg).

## When
- Test code creates an adapter and calls `createSession` with five shapes (mirroring the claude-code spec for symmetry):
  1. `const a = createHermesAdapter({ cwd: "/opt/default", spawnFn: mock });`
     `await a.createSession({ initialQuery: "hi", cwd: "/srv/projects/x" });`
  2. `const b = createHermesAdapter({ cwd: "/opt/default", spawnFn: mock });`
     `await b.createSession({ initialQuery: "hi" });`  // no per-call cwd
  3. `const c = createHermesAdapter({ spawnFn: mock });`
     `await c.createSession({ initialQuery: "hi" });`  // no constructor cwd, no per-call cwd
  4. `const d = createHermesAdapter({ spawnFn: mock });`
     `await d.createSession({ initialQuery: "hi", cwd: 42 });`  // wrong type
  5. `const e = createHermesAdapter({ spawnFn: mock });`
     `await e.createSession({ initialQuery: "hi", cwd: "" });`  // empty string
- Each `mock` returns canned stdout/stderr matching the contract from `adapter-hermes-create-session.md` (a `session_id: <id>` line on stderr, exit 0).
- A follow-up `send` is called on the ref returned by case 1: `await a.send(ref, "do thing")`. The mock again records the spawn args.

## Then
- **Case 1 (per-call cwd wins)** — the captured `SpawnArgs.cwd === "/srv/projects/x"`. The constructor's `/opt/default` is ignored. The returned `ref.meta.cwd === "/srv/projects/x"` (replaces today's `process.cwd()` behavior on this code path only).
- **Case 2 (constructor default applies)** — `SpawnArgs.cwd === "/opt/default"`. `ref.meta.cwd === "/opt/default"`.
- **Case 3 (no cwd configured anywhere)** — `SpawnArgs.cwd === process.cwd()` at call time. `ref.meta.cwd === process.cwd()`. (Backward-compatible default; existing tests stay green.)
- **Case 4 (`config.cwd` is not a string)** — `createSession` rejects with an `Error` whose `.message` includes the literal `"cwd"` and the phrase `"must be a string"`. The mock spawnFn is **not** invoked. No NativeSessionRef is returned.
- **Case 5 (`config.cwd` is the empty string)** — Treated as absent. Falls through to constructor cwd or `process.cwd()`. Spawn is NOT rejected.
- **`send` honours the ref-pinned cwd** — the follow-up `send` in case 1 spawns `hermes chat --resume <id> ...` with `SpawnArgs.cwd === "/srv/projects/x"` (the value pinned on `ref.meta.cwd` at create time). The pre-existing per-nativeId mutex behavior is unchanged. As with claude-code, per-`send` cwd arguments are NOT supported.
- **`meta` shape value updated, keys unchanged** — `ref.meta` still has exactly `sourceTag`, `cwd`, `model`, `createdAt`. The `cwd` value is now whichever rule above applied, not unconditionally `process.cwd()`. Tests that assert `Object.keys(ref.meta)` continue to pass.
- **No `--cwd` flag** — the hermes argv continues to be `chat -q <query> --pass-session-id --quiet --source <tag>` (plus any allow-listed config flags). The adapter does NOT add a `--cwd` flag (hermes has no such flag) — cwd is set via `child_process.spawn`'s `cwd` option exclusively.
- **`config.cwd` is consumed, not forwarded** — `cwd` is treated as a Sumeru-meaningful key, NOT one of the hermes CLI passthrough flags. The argv built for hermes does NOT contain `--cwd <value>`. (Compare with `model`, `provider`, etc., which DO get passed through to hermes per the existing allow-list.) This is asserted by inspecting `SpawnArgs.args`.
- **Backward compatibility** — every test under `packages/adapter-hermes/tests/` written before this issue continues to pass. The new test cases live alongside, and the integration test (`SUMERU_HERMES_INTEGRATION=1`) gains a smoke check that creates a session in a temp dir and verifies hermes saw the right working directory (via a `--quiet` query that prints `pwd`).
- **Symmetry with adapter-claude-code** — the rules above are byte-identical to the rules in `adapter-claude-code-cwd.md`. The two adapters share an identical `cwd` resolution policy so the server can rely on a single contract regardless of which adapter is wired up. (Internally each adapter implements the resolution itself — the project does not factor it into a shared util because the "no class / no shared base" rule keeps adapters independent.)
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit 0. No `class`, no `interface`, no default exports, no optional `?:` properties added.
