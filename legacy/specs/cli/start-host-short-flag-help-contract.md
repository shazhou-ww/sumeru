---
scenario: "The -h short flag belongs to help, not host: `sumeru start -h` (and `sumeru -h`) prints help, host keeps only its long form --host, and START_HELP is corrected to stop advertising a -h short flag for host so the help text matches reality"
feature: cli-start
tags: [cli, start, short-flag, host, help, contract, conflict, issue-116]
---

## Given

- `@sumeru/cli@0.2.x` is built and `packages/cli/src/cli.ts` does early, manual help interception **before** cli-kit ever parses flags:
  - top level: `if (firstArg === undefined || firstArg === "--help" || firstArg === "-h") { print HELP_TEXT; exit 0 }` (cli.ts ~line 67),
  - per command: `if (firstArg === "start" && (argv[1] === "--help" || argv[1] === "-h")) { print START_HELP; exit 0 }` (cli.ts ~line 101).
  So `-h` in the **first option position** is unconditionally claimed by help and never reaches the flag parser.
- `START_HELP` currently advertises:
  ```
  -h, --host <host>        Bind address (default: 127.0.0.1)
  ```
  i.e. it promises `-h` as a short alias for `--host`. This is **doubly broken**:
  1. `-h` immediately after `start` is swallowed by the per-command help guard (prints help, never binds a host), and
  2. even past the guard, no flag named `h` is registered, so cli-kit would throw `Unknown option: --h` (same mechanism as `-p`, see `start-port-short-flag.md`).
  The advertised `-h` for host can therefore never work — it is a pure help-text lie.
- **Decision (records the issue's "修复方向" choice):** follow the universal CLI convention **`-h` = help**. `host` does **not** get a `-h` short flag. The contract is repaired by making the *help text* honest, not by trying to give host an unusable short flag. `--host` (long form) remains fully supported and unchanged. (`port` is independent and DOES get its `-p` short flag restored — see `start-port-short-flag.md`.)

## When

### When-1: `sumeru start -h`
- The operator runs `sumeru start -h`.

### When-2: top-level `sumeru -h`
- The operator runs `sumeru -h`.

### When-3: host via long flag still works
- The operator runs `sumeru start --host 0.0.0.0 -p 0 --ocas-dir <tmp>`.

### When-4: read the help surface
- The operator runs `sumeru start --help` and inspects the `Options:` block.

## Then

### Then-1: `sumeru start -h` prints start help, exit 0
- For When-1 the process writes `START_HELP` to stdout and exits `0`. It does **not** attempt to bind, does **not** treat `-h` as a host value, and does **not** print `Unknown option`.

### Then-2: `sumeru -h` prints top-level help, exit 0
- For When-2 the process writes `HELP_TEXT` to stdout and exits `0` (unchanged top-level behavior, asserted to lock the `-h`=help convention).

### Then-3: `--host` long flag binds the given address
- For When-3 the server binds `0.0.0.0` and prints `Listening on http://0.0.0.0:<n>` (n = the ephemeral port from `-p 0`). The long `--host` path is untouched by this fix.

### Then-4: START_HELP no longer advertises a -h short flag for host
- For When-4 the `Options:` block lists host as the long form **only**, e.g.:
  ```
  --host <host>            Bind address (default: 127.0.0.1)
  ```
  The `-h, ` prefix on the host line is **removed**. After this change, **every** short flag named in `START_HELP` actually works:
  - `-p` → port (restored in `start-port-short-flag.md`),
  - `-c` → config (already worked),
  - `-h` → documented as help (top of help, `-h, --help`), not host.
  There is no entry in the help text promising a short flag that the parser would reject. (Help-text/registration consistency is exactly the contract `start-port-short-flag.md` Then-5 asserts for `port`; this spec asserts the host/help half.)

### Then-5: no regression to other start flags
- `--port` / `-p`, `--config` / `-c`, `--ocas-dir`, `--force`, `--emit-assets` all behave exactly as specified in their own specs. This change touches only: (a) the `START_HELP` host line text, and (b) the explicit decision *not* to register an `h` flag for host. `--host` semantics and default (`127.0.0.1`) are unchanged.

### Then-6: regression test
- A test under `packages/cli/tests/` (spawn the built `dist/cli.js`, the `start-emit-assets.test.ts` pattern) asserts:
  - `sumeru start -h` exits `0` and stdout contains the start-help usage line (`Usage: sumeru start [options]`) — i.e. `-h` routes to help, never to host,
  - `sumeru start --help` stdout does **not** contain a `-h, --host` pairing (the host line has no `-h` short alias); a regex/contains check guards against the help-text lie regressing,
  - `sumeru start --host 127.0.0.1 -p 0 --ocas-dir <tmp>` still prints `Listening on http://127.0.0.1:<n>` (long-flag host unaffected).

### Then-7: build / quality gates
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. Repo conventions hold (`function` over `class`, named exports, `T | null`, kebab-case). The change is confined to `packages/cli/src/cli.ts` (string constant + flag registration) plus its test.
- Shares the issue #116 `@sumeru/cli` **patch** changeset with `start-port-short-flag.md` (one changeset for the whole short-flag fix), or a sibling `patch` entry — no separate version bump.

## Non-goals

- **No** attempt to give host a different short flag (e.g. `-H`). The issue offers "host 不提供 -h 短 flag" as the preferred branch; introducing a brand-new letter is a larger UX decision and out of scope. Host stays long-form-only.
- **No** change to the early help-interception mechanism itself (the manual `argv` guards) — only the advertised host line in `START_HELP` is corrected.
- **No** change to `-p` / `port` behavior — that is `start-port-short-flag.md`. This spec only removes the false `-h` host advertisement and pins `-h` = help.
- **No** change to the top-level `HELP_TEXT` (`-h, --help` there is already correct and is merely asserted, not edited).
