---
scenario: "sumeru start -p <port> is accepted and binds the given port — the short alias is registered like config/c, and (unlike config) the default is applied AFTER resolving the alias so an explicit -p value is never shadowed by port's default"
feature: cli-start
tags: [cli, start, short-flag, port, alias, regression, issue-116]
---

## Given

- `@sumeru/cli@0.2.x` is built (`pnpm run build`) and the `sumeru start` command is registered in `packages/cli/src/cli.ts` on top of `@ocas/cli-kit@0.2.1`.
- cli-kit has **no native flag-alias support** (see `@ocas/cli-kit`'s `dist/args.js` `parseArgv`, and ocas #230). Its short-flag handling is:
  - A token `-X` is sliced to `body = "X"`. If `body.length !== 1` it throws `Unknown option: -XY`. If length 1, `key = "X"` and it looks up `definitions["X"]`.
  - If no flag is registered under that exact single letter, it throws **`Unknown option: --X`** (the `--` is always prepended in the error text — this is why `-p` surfaces as `Unknown option: --p`).
- The pre-fix `start` command registers only **one** short alias:
  ```ts
  cli
    .command("start")
    .flag("port", { type: "number", default: 7900 })
    .flag("host", { type: "string", default: "127.0.0.1" })
    .flag("config", { type: "string" })
    .flag("c", { type: "string" })        // short alias for --config — present
    // (no "p", no "h")                    // ← the bug: -p / -h never registered
  ```
  and resolves config in the action with `flags.config ?? flags.c ?? null`.
- **Why the config/c pattern works but a naive port/p copy does NOT:** `config` has **no `default`**, so when `--config` is absent `flags.config` is `undefined` and `flags.config ?? flags.c` falls through to the alias correctly. `port` has `default: 7900`, and cli-kit pre-seeds every defaulted flag (args.js seeds `flags[name] = definition.default` for all definitions). So `flags.port` is **always** `7900` when `--port` is omitted — a naive `flags.port ?? flags.p` would resolve to `7900` and **silently ignore** `-p 8080`. The fix must therefore resolve the alias *before* applying the 7900 default, not rely on `??` against an already-defaulted value.
- `START_HELP` already advertises `-p, --port <number>` as a supported short flag, so today the help text and the actual flag registration disagree — a user-facing contract break.

## When

### When-1: short `-p` with an explicit non-default port
- The operator runs (against a known-free port `P`, e.g. obtained from a sibling `net.createServer().listen(0)` then closed):
  ```
  sumeru start -p <P> --ocas-dir <tmp>
  ```

### When-2: short `-p 0` (ephemeral)
- The operator runs `sumeru start -p 0 --ocas-dir <tmp>`.

### When-3: long `--port` regression
- The operator runs `sumeru start --port <P> --ocas-dir <tmp>`.

### When-4: both `-p` and `--port` supplied
- The operator runs `sumeru start --port <P> -p <Q> --ocas-dir <tmp>` (two different values).

## Then

### Then-1: `-p <P>` is accepted and binds exactly `P`
- For When-1 the process starts and prints to stdout, within ~2s:
  ```
  Listening on http://127.0.0.1:<P>
  ```
  matching `^Listening on http://127\.0\.0\.1:<P>$`. It does **not** print or emit any `Unknown option` text — neither the raw `Unknown option: --p` string nor the rendered `{"type":"@sumeru/error","value":{"message":"Unknown option: --p","command":"start"}}` envelope — and does **not** exit `1` at parse time.
- **The bound port is `P`, not `7900`.** This is the load-bearing assertion that distinguishes the correct fix from the naive `flags.port ?? flags.p` (which would bind `7900` because `port`'s default shadows the alias). The test MUST assert the concrete `P`, not merely "some port".
- `SIGTERM`/`SIGINT` shuts the process down cleanly (exit 0, port released) — unchanged from `cli-graceful-shutdown.md`.

### Then-2: `-p 0` yields an OS-chosen ephemeral port
- For When-2 the process prints `Listening on http://127.0.0.1:<n>` where `<n>` is a real, bound, non-zero TCP port (the kernel's choice), exactly as `--port 0` does today.

### Then-3: `--port` is unchanged
- For When-3 the long flag continues to bind `P` exactly as before this fix — no regression to the long-flag path.

### Then-4: explicit `--port` and `-p` resolve to one deterministic value
- For When-4 the command binds a single, well-defined port (it does not crash or double-bind). The chosen precedence is documented in the implementation (long `--port` and short `-p` are two spellings of the same option; when both are present the resolution order is fixed and asserted by the test). The point of this case is that supplying both is **not** an `Unknown option` error and **not** undefined behavior.

### Then-5: help ↔ registration consistency
- `sumeru start --help` (and `sumeru start -h`) continues to list `-p, --port <number>   TCP port to bind (0 = ephemeral) (default: 7900)`, and that advertised `-p` now actually works — the help text and the real flag set agree (the contract the issue calls out as broken is restored for `port`; the `-h`/host half is handled in `start-host-short-flag-help-contract.md`).

### Then-6: regression test
- A spawn-based integration test under `packages/cli/tests/` (mirroring `start-graceful-shutdown.test.ts` / `start-emit-assets.test.ts` — spawn the built `dist/cli.js`, capture stdout/stderr/exit) covers:
  - `sumeru start -p <P> --ocas-dir <tmp>` prints `Listening on http://127.0.0.1:<P>` (the **exact** free port `P`), proving `-p` is both accepted and value-honored — this case fails against the naive `?? 7900` implementation,
  - `sumeru start -p 0` binds a real ephemeral port,
  - the process exits 0 on `SIGTERM` and frees the port.
  A free `P` is obtained deterministically (sibling listener on `:0`, read `.address().port`, close) before spawning, the way `cli-startup-port-check.md`'s tests source a port. Each spawn uses an isolated `SUMERU_PID_FILE` and `--ocas-dir <tmp>` so cases don't collide.

### Then-7: build / quality gates
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit `0`. New code follows the repo conventions: `function` over `class`, named exports, `T | null` over `?:`, kebab-case files. The fix lives in the existing `packages/cli/src/cli.ts` (plus its test); no new package.
- A `.changeset/<slug>.md` declares `@sumeru/cli` — `patch` (bug fix: `-p` short flag now honored). May be shared with `start-host-short-flag-help-contract.md` under a single changeset for issue #116.

## Non-goals

- **No** change to cli-kit itself — the alias is registered at the `start` call site, not by adding alias support upstream (that is ocas #230's scope).
- **No** new short aliases beyond restoring the ones `START_HELP` already advertises (`-p`; `-h`/host is a separate decision spec).
- **No** change to `--port 0` ephemeral semantics, the `EADDRINUSE` diagnostic (`cli-startup-port-check.md`), or the pid-file / graceful-shutdown behavior.
