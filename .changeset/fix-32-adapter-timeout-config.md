---
"@sumeru/server": minor
"@sumeru/cli": minor
"@sumeru/adapter-claude-code": minor
---

fix: make adapter timeouts (and any adapter option) configurable from `sumeru.yaml`, raise claude-code default `sendTimeoutMs` to 30 min

Adds an optional `config:` block per gateway in `sumeru.yaml`. The block is
parsed verbatim by `@sumeru/server`'s YAML loader (rejecting non-mapping
shapes with errors that name path / gateway / field) and forwarded by
`@sumeru/cli` to the matching adapter factory at boot. The claude-code
adapter consumes `sendTimeoutMs`, `createSessionTimeoutMs`, `maxTurns`,
`model`, `claudeBin`, and `cwd` directly from this blob — the old
hard-coded 10-minute send timeout was killing long-running solve-issue
runs (15-25 min). Default raised to 30 min; operators can still override
both directions via the YAML.

```yaml
gateways:
  claude-code:
    adapter: claude-code
    config:
      sendTimeoutMs: 1800000        # 30 min
      createSessionTimeoutMs: 300000 # 5 min
      maxTurns: 120
    capabilities:
      resume: true
      streaming: true
```

No-config YAML keeps booting byte-identically — the loader emits
`config: null` and the CLI forwards `{}` to factories.

Fixes #32.
