# examples/minimal — Sumeru v3 minimal runnable Host

The first runnable v3 example. A minimal `host.yaml` plus one prototype, enough to
boot `@sumeru/host` and answer the read-only **discovery** endpoints.

## Layout

```
examples/minimal/
  host.yaml                              # HostConfig
  prototypes/
    echo-worker/
      manifest.yaml                      # Prototype manifest
      compose.yaml                       # Docker compose for session containers
```

## Run

Build once, then start the host from the **repo root** with this dir as `rootDir`:

```bash
pnpm install && pnpm run build
SUMERU_PORT=7911 node packages/host/dist/main.js examples/minimal
```

Defaults: `SUMERU_HOST=127.0.0.1`, `SUMERU_PORT=7900`. A `data/` dir is created at
boot for OCAS recordings and is gitignored.

## Discovery (read-only) endpoints

```bash
curl -s http://127.0.0.1:7911/                          # @sumeru/host identity envelope
curl -s http://127.0.0.1:7911/prototypes                # @sumeru/prototype-list
curl -s http://127.0.0.1:7911/prototypes/echo-worker    # @sumeru/prototype
curl -s http://127.0.0.1:7911/sessions                  # @sumeru/session-list
curl -s http://127.0.0.1:7911/images                    # @sumeru/image-list
```

## Create a session

```bash
curl -s -X POST http://127.0.0.1:7911/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"echo-worker","project":"demo","task":"Say hello","model":null,"env":null}'
```
