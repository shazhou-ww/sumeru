---
scenario: "GET / returns an instance envelope whose gateways list reflects sumeru.yaml"
feature: server-http
tags: [http, envelope, ocas, instance, config, phase-1]
---

## Given
- `pnpm run build` has been run successfully from the worktree root.
- `@sumeru/cli`'s `start` subcommand accepts a new option `-c, --config <path>` that points at a `sumeru.yaml` file. When provided, the CLI calls `loadConfig(path)` from `@sumeru/server` and passes the parsed `InstanceConfig` into `startServer`.
- A fixture `tests/fixtures/sumeru.two-gateways.yaml` exists with:
  ```yaml
  name: sumeru@neko
  gateways:
    hermes:
      adapter: hermes
      capabilities: { resume: true, streaming: true }
    claude-code:
      adapter: claude-code
      capabilities: { resume: true, streaming: false }
  ```
- The server's `package.json` version is `0.1.0`.

## When
- The contributor runs `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` and waits for the `Listening on http://127.0.0.1:<port>` line.
- A client issues `curl -fsS -i http://127.0.0.1:<port>/`.

## Then
- HTTP status is `200 OK`.
- Response header `Content-Type` starts with `application/json`.
- Response body is exactly an ocas envelope:
  ```json
  {
    "type": "@sumeru/instance",
    "value": {
      "name": "sumeru@neko",
      "version": "0.1.0",
      "gateways": ["hermes", "claude-code"]
    }
  }
  ```
- The top-level keys are exactly `type` and `value`.
- `value.gateways` is an array of **gateway names** (strings), in the order they were declared in `sumeru.yaml` — NOT objects, NOT a map.
- `value.name` matches the `name` field from the loaded YAML (`sumeru@neko`), NOT the hard-coded default `sumeru` from Phase 0.
- A `POST /` still returns HTTP `405` with an `Allow: GET` response header and a `@sumeru/error` envelope body.
- When `sumeru start` is run **without** `--config`, `value.name` falls back to `"sumeru"` and `value.gateways` is `[]` (empty array, never `null`).
- When `sumeru start --config <path>` points at a non-existent or malformed file, the CLI prints a clear error to stderr (mentioning the path) and exits non-zero **before** binding any port.
