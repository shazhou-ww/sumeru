---
scenario: "claude-code adapter accepts sendTimeoutMs / createSessionTimeoutMs / maxTurns from sumeru.yaml gateway config; default sendTimeoutMs is raised from 10min to 30min for long-running tasks"
feature: adapter-claude-code
tags: [adapter, claude-code, timeout, config, issue-32]
---

## Given
- `specs/config-load-gateway-config-blob.md` and `specs/cli-pass-gateway-config.md` have landed: the YAML loader carries `gateway.config` and the CLI forwards it to the adapter factory.
- `createClaudeCodeAdapter(opts?: Partial<ClaudeCodeAdapterOptions>): Adapter` already accepts `sendTimeoutMs`, `createSessionTimeoutMs`, and `maxTurns` per `specs/adapter-claude-code-package-scaffold.md`. Defaults today are:
  - `DEFAULT_CREATE_TIMEOUT_MS = 5 * 60_000` (5 min)
  - `DEFAULT_SEND_TIMEOUT_MS = 30 * 60_000` (30 min) — **raised** from the previous 10 min by this issue, per the workaround the operator already applied locally.
  - `DEFAULT_MAX_TURNS = 90`
- The factory's `??` fallback is preserved: `null` → use the default constant.
- The send-timeout test seam from `specs/adapter-claude-code-send.md` is in place: a fake `spawnFn` receives a `SpawnArgs` object with the requested `timeoutMs` and can be inspected from tests.

## When
- A test constructs the adapter directly with explicit options:
  ```typescript
  const fakeSpawn = makeFakeSpawn();
  const adapter = createClaudeCodeAdapter({
    sendTimeoutMs: 1_800_000,
    createSessionTimeoutMs: 300_000,
    maxTurns: 120,
    spawnFn: fakeSpawn,
  });
  await adapter.createSession({ initialQuery: "hi" });
  // …later…
  await adapter.send(ref, "hello");
  ```
- A second test constructs the adapter with no options (`createClaudeCodeAdapter({})`) and runs the same operations.
- An end-to-end test boots the CLI against a fixture `sumeru.cc-timeout.yaml`:
  ```yaml
  name: sumeru@neko
  gateways:
    claude-code:
      adapter: claude-code
      config:
        sendTimeoutMs: 1800000
        createSessionTimeoutMs: 300000
        maxTurns: 120
      capabilities:
        resume: true
        streaming: true
  ```
  with a fake adapter-spawn seam that captures the options the factory received.

## Then
- **Direct factory test** — The adapter calls `spawnFn` for `createSession` with `timeoutMs === 300_000` and for `send` with `timeoutMs === 1_800_000`. The `--max-turns` argument is `"120"`.
- **Default factory test** — `createClaudeCodeAdapter({})` calls `spawnFn` for `createSession` with `timeoutMs === 5 * 60_000` (unchanged). For `send`, `timeoutMs === 30 * 60_000` — i.e. the **new** 30-minute default. (This is the fix to the original bug: the previous default of 10 min was inadequate for long CC runs.)
- **Default raise is documented** — A comment in `packages/adapter-claude-code/src/adapter.ts` explains the 30 min choice references issue #32 (uwf solve-issue developer role timing out at 10 min). The comment cites that operators may further override via `sumeru.yaml`'s `gateways.<name>.config.sendTimeoutMs` and that 30 min is a balance between "long enough for typical CC tasks" and "short enough to detect a wedged process".
- **End-to-end via CLI** — Booting `sumeru start --config sumeru.cc-timeout.yaml` constructs the adapter with `{ sendTimeoutMs: 1_800_000, createSessionTimeoutMs: 300_000, maxTurns: 120 }`. The captured options object equals the YAML's parsed `config` block byte-for-byte.
- **Timeout error message preserved** — When `spawnFn` reports `timedOut: true` from `send`, the adapter still throws `Error("send timed out after <timeoutMs>ms")` with `<timeoutMs>` reflecting the **operator-configured** value (e.g. `"send timed out after 1800000ms"`). The same applies to `createSession`.
- **Type surface unchanged** — `ClaudeCodeAdapterOptions` keeps all existing fields and their `T | null` shape. No new fields are added by this spec.
- **Test seam unchanged** — `spawnFn` continues to be the only test seam; no new test hooks are introduced.
- **Backward compatibility** — Existing tests in `packages/adapter-claude-code/tests/send.test.ts` and `create-session.test.ts` must be updated **only** for the new 30-min `send` default (any test that asserted on `10 * 60_000` is rewritten to assert `30 * 60_000`). All other assertions are unchanged.
- **Issue acceptance criterion** — The original issue #32 example YAML is functional:
  ```yaml
  gateways:
    claude-code:
      adapter: claude-code
      config:
        sendTimeoutMs: 1800000
        createSessionTimeoutMs: 300000
        maxTurns: 120
      capabilities:
        resume: true
        streaming: true
  ```
  After `sumeru start --config <this-file>`, the running adapter uses 30-min send / 5-min create / 120-max-turn limits without any source code change or rebuild.
- **Tests** —
  - `packages/adapter-claude-code/tests/options-from-config.test.ts` covers the direct-factory cases (custom + default).
  - `packages/cli/tests/start-with-cc-timeout-config.test.ts` covers the end-to-end CLI booting case.
  - The pre-existing `send.test.ts`'s default-timeout assertion is updated to `30 * 60_000`.
- **Workaround removal** — Any local commit that hard-coded the new default in source (per the issue's "Workaround" section) is folded into this PR's change to `DEFAULT_SEND_TIMEOUT_MS`. The PR description references issue #32.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
- A `.changeset/<slug>.md` declares:
  - `@sumeru/adapter-claude-code` — `minor` (default `sendTimeoutMs` raised; documents YAML-driven override).
