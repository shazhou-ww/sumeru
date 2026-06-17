---
scenario: "deploy/sumeru.service provides a systemd user service unit template for running Sumeru independently"
feature: deploy
tags: [deploy, systemd, service, operations]
---

## Given
- The Sumeru repository contains a `deploy/` directory.
- The file `deploy/sumeru.service` exists and is a valid systemd unit file.
- The target host has Node.js 22 installed at `/usr/bin/node`.
- The Sumeru repository is cloned to `$HOME/repos/sumeru` on the target host.
- The CLI has been built: `packages/cli/dist/cli.js` exists.
- A `sumeru.yaml` configuration file exists in the repository root.

## When
- The operator copies or symlinks `deploy/sumeru.service` to `~/.config/systemd/user/sumeru.service`.
- The operator runs `systemctl --user daemon-reload`.
- The operator runs `systemctl --user enable --now sumeru`.

## Then
- The `sumeru.service` unit file contains a `[Unit]` section with:
  - `Description=Sumeru Agent House`
  - `After=network.target`
- The `sumeru.service` unit file contains a `[Service]` section with:
  - `Type=simple`
  - `WorkingDirectory=%h/repos/sumeru` (where `%h` expands to the user's home directory)
  - `ExecStart=/usr/bin/node packages/cli/dist/cli.js start --port 7900 --config sumeru.yaml`
  - `Restart=always`
  - `RestartSec=5`
  - `StandardOutput=journal`
  - `StandardError=journal`
- The `sumeru.service` unit file contains an `[Install]` section with:
  - `WantedBy=default.target`
- After `systemctl --user enable --now sumeru`:
  - `systemctl --user status sumeru` shows `active (running)`.
  - The Sumeru HTTP endpoint responds at `http://127.0.0.1:7900/`.
  - `journalctl --user -u sumeru` captures stdout/stderr output from the Sumeru process.
- Sumeru runs as its own process tree under systemd, **not** as a child of `hermes-gateway.service`.
- When `hermes-gateway.service` is restarted (`systemctl --user restart hermes-gateway`), the Sumeru process (`systemctl --user status sumeru`) remains running and unaffected.
- When Sumeru crashes, systemd automatically restarts it within 5 seconds (`Restart=always`, `RestartSec=5`).

## Notes
- The unit file is a **template** stored in the repo; actual deployment (copying to `~/.config/systemd/user/`, enabling) is done by the operator, not by any CLI command.
- The `%h` specifier is a systemd special that expands to the user's home directory at runtime.
- This decoupling is the primary goal of issue #40: gateway restarts no longer kill Sumeru as collateral.
