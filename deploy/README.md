# Sumeru Deployment

Deploy Sumeru Host (`@sumeru/host`) as a systemd user service.

## Prerequisites

- Node.js 22 at `/usr/bin/node`
- Repository cloned to `$HOME/repos/sumeru`
- Host built: `pnpm run build` (produces `packages/host/dist/main.js`)
- A Sumeru root directory with `host.yaml` (created by `sumeru setup`)

## Install

1. Copy or symlink the unit file:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/sumeru.service ~/.config/systemd/user/sumeru.service
```

2. Configure adapter credentials (CLI adapters such as claude-code need this):

```bash
mkdir -p ~/.config/sumeru
cp deploy/sumeru.env.example ~/.config/sumeru/env
chmod 600 ~/.config/sumeru/env
$EDITOR ~/.config/sumeru/env
```

3. Reload and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now sumeru
```

## Operations

```bash
# Status
systemctl --user status sumeru

# Logs
journalctl --user -u sumeru -f

# Restart
systemctl --user restart sumeru
```

The service listens on `http://127.0.0.1:7900/` by default (`SUMERU_PORT`).

## Notes

- `ExecStart` passes the Sumeru root directory as the first argument to `main.js`.
- Adjust `WorkingDirectory`, `ExecStart` path, and the root directory argument if your layout differs from `$HOME/repos/sumeru`.
- Running Sumeru as its own user service keeps it independent of other gateway processes.
