---
scenario: "createHermesAdapter().createSession honors a per-call config.cwd, spawns hermes with that cwd, and records it on NativeSessionRef.meta — applying the same 5-case resolution policy as adapter-claude-code"
feature: adapter-hermes
tags: [adapter, hermes, cwd, workspace-root, spawn, issue-53, issue-66]
---

## Given
- The branch `fix/53-adapter-cwd-trio` is checked out (off `main`, AFTER the streaming-adapter-contract refactor #51 merged).
- The live adapter contract from `@sumeru/core` is: `createSession(config: SessionConfig): Promise<NativeSessionRef>` where `SessionConfig = { model: string | null; cwd: string | null }`, and `send(ref, content): AsyncIterable<SendEvent>`. There is NO `initialQuery` config field — `createSession` always spawns the fixed `"ping"` prompt to mint a session id. (Do not trust the pre-#51 issue text that mentions `initialQuery`; verify against the current code.)
- As of `main`, `@sumeru/adapter-hermes` does NOT yet implement the per-call cwd policy. Current state to be changed:
  - `packages/adapter-hermes/src/types.ts` — `SpawnArgs` is `{ command; args; timeoutMs }`; it has **no** `cwd` field. `HermesAdapterOptions` has **no** `cwd` field.
  - `packages/adapter-hermes/src/adapter.ts` — `createSession` does `const spawnCwd = config.cwd ?? undefined` and conditionally spreads `cwd` into the spawn call; there is no constructor fallback, no `process.cwd()` floor, no non-string rejection, no empty-string normalization. `meta.cwd` is set to `config.cwd ?? process.cwd()`.
  - `packages/adapter-hermes/src/spawn.ts` — `defaultSpawn` destructures only `{ command, args, timeoutMs }` and never forwards `cwd` to `child_process.spawn`.
- Issue #53 brings hermes to parity with `adapter-claude-code` (whose `SpawnArgs` already has `cwd: string` and whose `defaultSpawn` already forwards it). The required changes:
  1. `HermesAdapterOptions` gains a `cwd: string | null` field (constructor default; no optional `?:`).
  2. `SpawnArgs` in `packages/adapter-hermes/src/types.ts` gains a required `cwd: string` field, byte-identical to `adapter-claude-code`'s `SpawnArgs`, so production and the test seam share one signature.
  3. `createSession` resolves the effective cwd via the 5-case policy below and passes it as `SpawnArgs.cwd`, AND writes the SAME resolved value to `ref.meta.cwd`.
  4. `defaultSpawn` forwards the new `cwd` field to `child_process.spawn`'s `cwd` option (mirroring `adapter-claude-code/src/spawn.ts`).
- Tests extend the existing `makeSpawn` helper in `packages/adapter-hermes/tests/create-session.test.ts` so the `SpawnFn` it builds captures the `SpawnArgs` it receives (the captured shape now includes `cwd`).

## When
- Test code creates an adapter and calls `createSession` with five shapes (byte-identical to the claude-code cwd spec for symmetry). Each call passes a full `SessionConfig` whose `cwd` is the value under test:
  1. `const a = createHermesAdapter({ cwd: "/opt/default", spawnFn: mock, turnsReader: emptyTurns });`
     `await a.createSession({ model: null, cwd: "/srv/projects/x" });`            // per-call cwd present
  2. `const b = createHermesAdapter({ cwd: "/opt/default", spawnFn: mock, turnsReader: emptyTurns });`
     `await b.createSession({ model: null, cwd: null });`                           // no per-call cwd
  3. `const c = createHermesAdapter({ spawnFn: mock, turnsReader: emptyTurns });`
     `await c.createSession({ model: null, cwd: null });`                           // no constructor cwd, no per-call cwd
  4. `const d = createHermesAdapter({ spawnFn: mock, turnsReader: emptyTurns });`
     `await d.createSession({ model: null, cwd: 42 as unknown as string });`        // wrong type
  5. `const e = createHermesAdapter({ spawnFn: mock, turnsReader: emptyTurns });`
     `await e.createSession({ model: null, cwd: "" });`                              // empty string
- Each `mock` returns a canned `session_id: <id>` line on stderr (or legacy `Session: <id>` on stdout), exit 0 — matching `adapter-hermes-create-session.md`.
- A follow-up `send` is exercised against the ref returned by case 1 to verify cwd pinning: the same `mock` records the spawn args of the `--resume` call, and the resulting `AsyncIterable<SendEvent>` is drained. (The full send contract lives in `adapter-hermes-send.md` for #66.)

## Then
- **Case 1 (per-call cwd wins)** — the captured `SpawnArgs.cwd === "/srv/projects/x"`. The constructor's `/opt/default` is ignored. The returned `ref.meta.cwd === "/srv/projects/x"`.
- **Case 2 (constructor default applies)** — `SpawnArgs.cwd === "/opt/default"`. `ref.meta.cwd === "/opt/default"`.
- **Case 3 (no cwd configured anywhere)** — `SpawnArgs.cwd === process.cwd()` at call time. `ref.meta.cwd === process.cwd()`. (Backward-compatible default; existing tests stay green.)
- **Case 4 (`config.cwd` is not a string)** — `createSession` rejects with an `Error` whose `.message` includes BOTH the literal substring `"cwd"` AND the phrase `"must be a string"`. The mock `spawnFn` is **not** invoked (assert spawn count / captured-calls length is 0). No `NativeSessionRef` is returned. The guard is `config.cwd !== null && typeof config.cwd !== "string"` — `null` is "absent" (legal), only a non-null non-string value rejects.
- **Case 5 (`config.cwd` is the empty string)** — Treated as absent (mirrors the server-side `resolveSessionCwd` empty-string handling). Resolution falls through to the constructor cwd if present, else `process.cwd()`. The spawn is **not** rejected. For adapter `e` (no constructor cwd): `SpawnArgs.cwd === process.cwd()` and `ref.meta.cwd === process.cwd()`.
- **Single resolution expression (SpawnArgs.cwd === meta.cwd always)** — the effective cwd is computed exactly once as
  `(typeof config.cwd === "string" && config.cwd.length > 0) ? config.cwd : (options.cwd ?? process.cwd())`,
  with the Case-4 non-string-rejection guard evaluated *before* this expression. The identical resolved string is used for BOTH `SpawnArgs.cwd` and `ref.meta.cwd`; they can never diverge.
- **`send` honours the ref-pinned cwd** — the follow-up `send` in case 1 spawns `hermes chat -q <content> --resume <id> ...` with `SpawnArgs.cwd === "/srv/projects/x"` (the value pinned on `ref.meta.cwd` at create time, NOT `process.cwd()`). The pre-existing per-`nativeId` mutex (`withRefLock`) is unchanged. Per-`send` cwd arguments are NOT supported — a session pins its cwd at birth.
- **`meta` keys unchanged, value updated** — `ref.meta` still has exactly the keys `sourceTag`, `cwd`, `model`, `createdAt` (sorted: `createdAt`, `cwd`, `model`, `sourceTag`). The existing `does not leak token-shaped fields into meta` test that snapshots `Object.keys(ref.meta).sort()` continues to pass. Only the `cwd` **value** changes — never again unconditionally `process.cwd()`.
- **No `--cwd` flag** — the hermes argv remains `chat -q <query> --pass-session-id --quiet --source <tag>` (plus `--model <m>` when set). The adapter does NOT add a `--cwd` segment to `args` (hermes has no such flag); cwd is conveyed exclusively via `child_process.spawn`'s `cwd` option. Assert absence of `"--cwd"` in `SpawnArgs.args`.
- **`config.cwd` is consumed, not forwarded** — `cwd` is a Sumeru-meaningful key, never passed through as a hermes CLI flag (contrast `model`, which IS forwarded as `--model`). Asserted via `SpawnArgs.args`.
- **`defaultSpawn` forwards cwd** — `packages/adapter-hermes/src/spawn.ts` destructures `cwd` from `SpawnArgs` and passes it to `child_process.spawn(command, args, { cwd, ... })`. Argv hygiene preserved: `cwd: "/path with spaces/中文/🍊"` is captured verbatim — no shell, no escaping.
- **Backward compatibility** — every pre-existing test under `packages/adapter-hermes/tests/` continues to pass. Existing tests calling `createSession({ model: ..., cwd: null })` still observe `ref.meta.cwd` as a string equal to `process.cwd()`. New cases 1–5 are ADDED to `create-session.test.ts` (not replacing existing assertions).
- **Symmetry with adapter-claude-code** — the rules above are byte-identical to `adapter-claude-code-cwd.md`. Both adapters share one cwd policy so the server relies on a single contract regardless of which adapter is wired. Each adapter implements the resolution inline (no shared util — the "no class / no shared base" convention keeps adapters independent).
- **Integration smoke (opt-in)** — gated on `SUMERU_HERMES_INTEGRATION=1`: create a session in a temp dir (`cwd: <tmpDir>`) and assert hermes observed that working directory.
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit 0. No `class`, no `interface`, no default exports, no optional `?:` properties added.
