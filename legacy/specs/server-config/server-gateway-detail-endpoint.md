---
scenario: "GET /gateways/:name returns the single gateway envelope, or a 404 @sumeru/error envelope when missing"
feature: server-http
tags: [http, envelope, ocas, gateways, error, 404, phase-1]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares two gateways: `hermes` and `claude-code` (see `server-instance-endpoint-config.md`).

## When
- The client issues each of the following requests in order:
  1. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes`
  2. `curl -fsS -i http://127.0.0.1:<port>/gateways/claude-code`
  3. `curl -sS -i http://127.0.0.1:<port>/gateways/does-not-exist`
  4. `curl -sS -i -X POST http://127.0.0.1:<port>/gateways/hermes`
  5. `curl -sS -i 'http://127.0.0.1:<port>/gateways/%2E%2E%2Fetc%2Fpasswd'` (URL-encoded `../etc/passwd` — path traversal probe)

## Then
- **Request 1 (`hermes`)** — HTTP `200`, `Content-Type: application/json...`, body:
  ```json
  {
    "type": "@sumeru/gateway",
    "value": {
      "name": "hermes",
      "adapter": "hermes",
      "status": "ready",
      "activeSessions": 0,
      "capabilities": { "resume": true, "streaming": true }
    }
  }
  ```
  Top-level keys are exactly `type` and `value`. Value object has the same five keys (`name`, `adapter`, `status`, `activeSessions`, `capabilities`) as a single entry of `@sumeru/gateway-list`.
- **Request 2 (`claude-code`)** — HTTP `200`, body shape identical to request 1 with `name: "claude-code"`, `adapter: "claude-code"`, `capabilities.streaming: false`.
- **Request 3 (`does-not-exist`)** — HTTP `404`, `Content-Type: application/json...`, body:
  ```json
  {
    "type": "@sumeru/error",
    "value": {
      "error": "gateway_not_found",
      "message": "Gateway does-not-exist not found"
    }
  }
  ```
  - `value.error` is the snake_case stable code `gateway_not_found` (so callers can switch on it).
  - `value.message` is human-readable and includes the requested gateway name.
  - The body is **never** the generic `not_found` from the unknown-path 404 — `gateway_not_found` is distinct.
- **Request 4 (`POST /gateways/hermes`)** — HTTP `405` with `Allow: GET` response header and a `@sumeru/error` envelope (`error: "method_not_allowed"`).
- **Request 5 (`%2E%2E%2Fetc%2Fpasswd`)** — HTTP `404` with a `@sumeru/error` envelope (`error: "gateway_not_found"`). The server treats the URL-decoded path segment as a literal gateway name (`../etc/passwd`), looks it up in the config map, finds nothing, and returns 404. No filesystem access is performed.
- A `GET /gateways/hermes/` (trailing slash) is equivalent to `GET /gateways/hermes` and returns the same `200` envelope.
- A `GET /gateways/HERMES` (different case) returns a `404 gateway_not_found` envelope — gateway-name lookup is case-sensitive (matches the YAML key exactly).
- The response body for **every** Phase 1 endpoint (200, 404, 405) is a JSON ocas envelope; none of them returns plain text, an HTML error page, or a Node.js stack trace.
- All Phase 0 behaviors continue to pass: `GET /` still returns `@sumeru/instance`, `GET /unknown-path` still returns `@sumeru/error` with `error: "not_found"`, `POST /` still returns `405 + Allow: GET`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. Tests cover at minimum: 200 hits for both gateways, 404 for an unknown gateway, 405 for `POST /gateways/hermes`, the empty-gateways edge case in `GET /gateways`, and the YAML loader error paths from `config-load-yaml.md`.
