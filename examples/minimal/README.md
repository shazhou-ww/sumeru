# examples/minimal — Sumeru v2 minimal runnable Host

The first runnable v2 example. A minimal `host.yaml` plus one prototype, enough to
boot `@sumeru/host`, seed the reserved master `inst_0`, and answer the read-only
**discovery** endpoints. Shared prerequisite for later scenarios (master roundtrip,
SSE, worker lifecycle, ...).

## Layout

```
examples/minimal/
  host.yaml                              # HostConfig (validateHostConfig)
  prototypes/
    echo-worker/
      manifest.yaml                      # Manifest (validateManifest)
      compose.yaml                       # opaque, forwarded to docker compose (workers only)
```

## Run

Build once, then start the host from the **repo root** with this dir as `rootDir`:

```bash
pnpm install && pnpm run build
SUMERU_PORT=7911 node packages/host/dist/main.js examples/minimal
```

Defaults: `SUMERU_HOST=127.0.0.1`, `SUMERU_PORT=7900`. The master (`inst_0`) runs via
local transport (no Docker needed for discovery). A `data/` dir is created at boot for
OCAS recordings and is gitignored.

## Discovery (read-only) endpoints

```bash
curl -s http://127.0.0.1:7911/                          # @sumeru/host identity envelope
curl -s http://127.0.0.1:7911/prototypes                # @sumeru/prototype-list
curl -s http://127.0.0.1:7911/prototypes/echo-worker    # @sumeru/prototype (+ manifest)
curl -s http://127.0.0.1:7911/instances                 # @sumeru/instance-list (inst_0 in list)
curl -s http://127.0.0.1:7911/instances/inst_0/status   # @sumeru/instance-status
```

Spec: `specs/host/host-bootstrap-discovery.md`.
