---
"@sumeru/server": minor
"@sumeru/cli": minor
---

Phase 0: scaffold `@sumeru/server` package and add `sumeru start` CLI subcommand.

- New `@sumeru/server` package: minimal HTTP service using `node:http`.
- `GET /` returns the ocas envelope `{ type: "@sumeru/instance", value: { name, version, gateways: [] } }`.
- Unknown paths return `404` with the `@sumeru/error` envelope; `POST /` returns `405` with `Allow: GET`.
- New `sumeru start` CLI subcommand with `--port` (default `7900`, `0` = ephemeral) and `--host` (default `127.0.0.1`).
- Clean `EADDRINUSE` error messages and graceful `SIGINT` shutdown.
