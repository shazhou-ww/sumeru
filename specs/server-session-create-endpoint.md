---
scenario: "POST /gateways/:name/sessions creates a session, returns 201 + @sumeru/session envelope, and treats `config` as an opaque pass-through"
feature: server-http
tags: [http, session, create, envelope, ocas, opaque-config, phase-2]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares two gateways (`hermes` and `claude-code`, see `server-instance-endpoint-config.md`).
- The server's wall clock is in UTC; `Date.now()` is used for `createdAt`.

## When
- The client issues each of the following requests in order:
  1. `curl -fsS -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:<port>/gateways/hermes/sessions`
  2. `curl -fsS -i -X POST -H 'Content-Type: application/json' -d '{"config":{"model":"sonnet-4.5","systemPrompt":"be brief","temperature":0.2,"weirdAdapterField":42}}' http://127.0.0.1:<port>/gateways/hermes/sessions`
  3. `curl -fsS -i -X POST -H 'Content-Type: application/json' -d '' http://127.0.0.1:<port>/gateways/claude-code/sessions`  # empty body
  4. `curl -sS  -i -X POST -H 'Content-Type: application/json' -d '{"config":' http://127.0.0.1:<port>/gateways/hermes/sessions`  # malformed JSON
  5. `curl -sS  -i -X POST -H 'Content-Type: application/json' -d '{"config":"not-an-object"}' http://127.0.0.1:<port>/gateways/hermes/sessions`  # config wrong type
  6. `curl -sS  -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:<port>/gateways/does-not-exist/sessions`  # unknown gateway

## Then
- **Request 1 (empty config object)** — HTTP `201 Created`, `Content-Type: application/json...`, body:
  ```json
  {
    "type": "@sumeru/session",
    "value": {
      "id": "ses_<26-char-ULID>",
      "gateway": "hermes",
      "status": "idle",
      "createdAt": "<ISO-8601 UTC>",
      "config": {}
    }
  }
  ```
  - Top-level keys are exactly `type` and `value`.
  - `value` has exactly five keys: `id`, `gateway`, `status`, `createdAt`, `config`.
  - `value.id` matches `^ses_[0-9A-HJKMNP-TV-Z]{26}$` (see `server-session-id-ulid.md`).
  - `value.status` is the literal string `"idle"` for a freshly created session.
  - `value.createdAt` is an ISO-8601 timestamp in UTC ending with `Z` (e.g. `"2026-06-13T12:00:00.000Z"`); the parsed value is within 5 s of the request time.
  - `value.config` round-trips the request's `config` field unchanged. For the empty object case it is `{}`.
- **Request 2 (rich config)** — HTTP `201`. `value.config` is exactly:
  ```json
  { "model": "sonnet-4.5", "systemPrompt": "be brief", "temperature": 0.2, "weirdAdapterField": 42 }
  ```
  - The server **does not** drop, rename, normalise, or validate any field. `weirdAdapterField` (which Sumeru has never heard of) survives as-is — config is opaque per `architecture.md`.
  - Phase-2 implementation must not call into any adapter on `POST` (no native session is created yet); the config blob is stored verbatim alongside the session record.
- **Request 3 (empty body)** — HTTP `201`. The server treats an empty/missing body the same as `{}` and returns `value.config: {}`. A request with `Content-Type: application/json` but a zero-byte body must NOT 400.
- **Request 4 (malformed JSON)** — HTTP `400 Bad Request`, body is a `@sumeru/error` envelope with `value.error: "invalid_json"` (or equivalent stable code). No session is created (subsequent `GET .../sessions` does not list it).
- **Request 5 (`config` wrong type)** — HTTP `400`, body is a `@sumeru/error` envelope with `value.error: "invalid_request"` and a `value.message` mentioning the field name `config`. No session is created.
- **Request 6 (unknown gateway)** — HTTP `404`, `@sumeru/error` envelope with `value.error: "gateway_not_found"` and a message mentioning the gateway name `does-not-exist`. The error code is the **same** as the existing Phase-1 `GET /gateways/:name` 404 (so callers can switch on a single code).
- **Per-gateway counters** — after Requests 1–3 succeed, `GET /gateways` reports `activeSessions: 2` for `hermes` and `1` for `claude-code` (Phase-1 hard-coded `0` is replaced by a real count of non-closed sessions).
- **Method enforcement** — `GET /gateways/hermes/sessions` is the listing endpoint (covered in `server-sessions-list-endpoint.md`); `PUT`/`PATCH /gateways/hermes/sessions` returns `405 method_not_allowed` with `Allow: GET, POST` and a `@sumeru/error` envelope.
- All Phase-1 behaviors (`GET /`, `GET /gateways`, `GET /gateways/:name`, generic 404 / 405) continue to pass unchanged.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. Test coverage includes: success on both gateways, ULID-shape assertion, opaque-config round-trip with unknown fields, empty-body acceptance, malformed-JSON 400, wrong-type-config 400, unknown-gateway 404, and the 405 on disallowed methods.
