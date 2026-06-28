---
scenario: "GET / returns a minimal ocas-style instance envelope"
feature: server-http
tags: [http, envelope, ocas, instance]
---

## Given
- A `sumeru start --port 0` process is running and has printed `Listening on http://127.0.0.1:<port>`.
- The server has no gateways configured (Phase 0 — no adapters yet).
- The server's `package.json` version is `0.1.0`.

## When
- A client issues `curl -fsS -i http://127.0.0.1:<port>/`.

## Then
- HTTP status is `200 OK`.
- Response header `Content-Type` starts with `application/json` (e.g. `application/json; charset=utf-8`).
- Response body is a single JSON object shaped as an ocas envelope:
  ```json
  {
    "type": "@sumeru/instance",
    "value": {
      "name": "sumeru",
      "version": "0.1.0",
      "gateways": []
    }
  }
  ```
- The top-level keys are exactly `type` and `value` — no extra keys at the envelope level.
- `value.gateways` is an array (empty in Phase 0, since no adapters are wired yet) — never `null`, never absent.
- A `GET` to any unknown path (e.g. `/does-not-exist`) returns HTTP `404` with a JSON body of shape `{ "type": "@sumeru/error", "value": { "error": "not_found", "message": "<string>" } }` — even before other endpoints exist, the 404 path must already use the envelope.
- A `POST /` returns HTTP `405` with an `Allow: GET` response header.
