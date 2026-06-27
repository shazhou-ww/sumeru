---
"@sumeru/cli": patch
---

fix: register `-p` short flag for `sumeru start --port`, and pin `-h` to help

`sumeru start -p 7900` previously failed with `Unknown option: --p` even though
`START_HELP` advertised `-p, --port` and `-h, --host` as supported short flags.
The `start` command only ever registered the `-c` alias for `--config`, so the
help text and the actual flag set disagreed — a user-facing contract break
(issue #116).

Changes:
- Register `p` as a short alias for `--port` (separate flag name, the same
  cli-kit-has-no-aliases workaround used for `-c`/`--config`; see ocas#230).
- Drop `default: 7900` from the `port` flag and apply the default LAST in the
  action via `flags.port ?? flags.p ?? 7900`. cli-kit pre-seeds every defaulted
  flag, so keeping `default: 7900` would make `flags.port` always `7900` and
  silently shadow an explicit `-p 8080`. Resolving the alias before the default
  mirrors the working `config`/`c` pattern (which has no default). `-p 0` /
  `--port 0` ephemeral semantics are preserved (0 is a real value).
- Correct `START_HELP`: host is documented as long-form `--host` only. The old
  `-h, --host` line was a pure help-text lie — `-h` after `start` is claimed by
  the early help guard (universal `-h` = help) and host never registered an `h`
  flag. `--host` long form is unchanged.

Now every short flag named in `START_HELP` actually works: `-p` → port,
`-c` → config, `-h` → help.

Refs: #116
