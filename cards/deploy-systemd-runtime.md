---
id: deploy-systemd-runtime
title: "Systemd Runtime Environment"
sources:
  - deploy/sumeru.service
  - deploy/sumeru.env.example
  - README.md
tags: [deployment, systemd, runtime, adapters]
created: 2026-06-23
updated: 2026-06-23
---

# Systemd Runtime Environment

Sumeru runs as a standalone `systemd --user` service so gateway restarts do not kill the Sumeru process tree.

## Unit-Level Runtime Guarantees

`deploy/sumeru.service` encodes two critical runtime constraints for CLI-based adapters (`claude-code`, `codex`, `cursor-agent`):

- `Environment=PATH=...` explicitly includes npm/local binary paths because systemd user services do not inherit login-shell PATH.
- `EnvironmentFile=-%h/.config/sumeru/env` injects adapter credentials in service scope.

Without the PATH override, adapter subprocess spawn can fail with `ENOENT`. Without credentials, CLI adapters can fail authentication (for example "Not logged in").

## Secrets and Auth Injection Model

Repository policy is split between template and real secrets:

- `deploy/sumeru.env.example` is committed with placeholders only.
- real secrets live in `~/.config/sumeru/env` on each host.
- `chmod 600 ~/.config/sumeru/env` is required to keep tokens owner-readable only.

The env file format is strict systemd env-file syntax (`KEY=value`, no `export`).

## Optional Env File Behavior

The leading `-` in `EnvironmentFile=-...` makes the file optional.

- Hermes-only nodes can run without `~/.config/sumeru/env`.
- Nodes using CLI adapters must create the env file and restart/reload service state.

## Operational Flow

Documented host setup flow:

1. Install/link the unit into `~/.config/systemd/user/`.
2. Create `~/.config/sumeru/env` from `deploy/sumeru.env.example` when CLI adapters are enabled.
3. `systemctl --user daemon-reload`.
4. `systemctl --user enable --now sumeru`.

Steady-state operations are `journalctl --user -u sumeru -f`, `systemctl --user restart sumeru`, and `systemctl --user status sumeru`.
