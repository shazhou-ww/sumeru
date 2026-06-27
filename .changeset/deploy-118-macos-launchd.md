---
"@sumeru/cli": patch
---

deploy: add macOS launchd support (parity with the systemd user service)

macOS has no systemd, so `deploy/sumeru.service` could not run Sumeru as a
resident service on mac nodes. Add the launchd equivalent with the same
guarantees (start at login, restart on crash, own process tree):

- `deploy/sumeru.plist.example` — LaunchAgent (RunAtLoad + KeepAlive +
  ThrottleInterval), `__HOME__` placeholders since launchd does not expand
  `~` / `$HOME`.
- `deploy/sumeru-launchd-run.sh.example` — wrapper that sets PATH and sources
  the 0600 env file before `exec sumeru`, standing in for systemd's
  `EnvironmentFile=` (which launchd lacks).
- README 部署 section split into Linux (systemd) / macOS (launchd) branches
  with `launchctl bootstrap/kickstart/print/bootout` management commands.

Credentials stay in `~/.config/sumeru/env` (0600, git-ignored); the env file
format is shared with the systemd path. hermes-only nodes need no env file —
the hermes adapter reads creds from `~/.hermes/config.yaml`, not the
environment.

Closes #118
