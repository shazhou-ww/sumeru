---
scenario: "GET /gateways returns a list envelope of every configured gateway with adapter + capabilities"
feature: server-http
tags: [http, envelope, ocas, gateways, phase-1]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares two gateways (`hermes` first, `claude-code` second), as defined in `server-instance-endpoint-config.md`.
- No sessions have been created yet (Phase 1 has no session machinery; gateway-level session counts are static placeholders).

## When
- A client issues `curl -fsS -i http://127.0.0.1:<port>/gateways`.

## Then
- HTTP status is `200 OK`.
- Response header `Content-Type` starts with `application/json`.
- Response body is shaped:
  ```json
  {
    "type": "@sumeru/gateway-list",
    "value": [
      {
        "name": "hermes",
        "adapter": "hermes",
        "status": "ready",
        "activeSessions": 0,
        "capabilities": { "resume": true, "streaming": true }
      },
      {
        "name": "claude-code",
        "adapter": "claude-code",
        "status": "ready",
        "activeSessions": 0,
        "capabilities": { "resume": true, "streaming": false }
      }
    ]
  }
  ```
- The top-level keys are exactly `type` and `value`.
- `value` is an array, **never** an object or `null`. With zero gateways configured the array is `[]` and `type` is still `@sumeru/gateway-list`.
- The order of entries in `value` matches the YAML declaration order (`hermes` before `claude-code`).
- Every entry has all five keys (`name`, `adapter`, `status`, `activeSessions`, `capabilities`) — no extra keys, no missing keys.
- `status` is the literal string `"ready"` for every gateway in Phase 1 (no health-checking yet).
- `activeSessions` is the number `0` for every gateway in Phase 1 (sessions land in Phase 2).
- `capabilities` is an object with exactly `resume` and `streaming` boolean keys, mirroring the YAML.
- A `POST /gateways` returns HTTP `405` with `Allow: GET` and a `@sumeru/error` envelope body.
- `GET /gateways/` (with a trailing slash) is treated equivalently to `GET /gateways` — both return the same `@sumeru/gateway-list` envelope.
- A `GET /gateways?anything=ignored` returns the same body — query-string parameters are ignored in Phase 1.
