---
scenario: "README.md contains a Deployment section documenting systemd user service setup"
feature: docs
tags: [docs, deploy, readme, systemd]
---

## Given
- The Sumeru repository contains a `README.md` at the root.
- The `deploy/sumeru.service` unit template exists (see `deploy-systemd-service-unit.md`).

## When
- A user reads `README.md` looking for deployment instructions.

## Then
- `README.md` contains a `## Deployment` section (or `## 部署` for Chinese consistency with the rest of the README).
- The Deployment section documents the following:

### Installation steps
1. Copy or symlink the unit file:
   ```bash
   mkdir -p ~/.config/systemd/user
   cp deploy/sumeru.service ~/.config/systemd/user/
   # or: ln -s $(pwd)/deploy/sumeru.service ~/.config/systemd/user/
   ```
2. Reload systemd:
   ```bash
   systemctl --user daemon-reload
   ```
3. Enable and start the service:
   ```bash
   systemctl --user enable --now sumeru
   ```

### Viewing logs
```bash
journalctl --user -u sumeru -f
```

### Restarting the service
```bash
systemctl --user restart sumeru
```

### Checking status
```bash
systemctl --user status sumeru
```

### Decoupling note
- The section explains that running Sumeru as its own systemd user service decouples it from `hermes-gateway.service`, so gateway restarts no longer kill Sumeru.
- This resolves the process-tree dependency issue where Sumeru was previously started as a child of the gateway.

## Notes
- The README should maintain its existing style (Chinese headings if the rest is in Chinese, consistent formatting).
- Installation commands use `--user` flag throughout since this is a user service, not a system service.
- The symlink option is mentioned as an alternative for development workflows where the unit file may be updated.
