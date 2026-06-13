---
scenario: "DELETE /gateways/:name/sessions/:id closes the session, returns 204, and is idempotent — closed sessions remain queryable"
feature: server-http
tags: [http, session, delete, close, envelope, error, 204, 404, phase-2]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares a `hermes` gateway.
- The client has just created session A on `hermes` (id `ses_<A>`, status `idle`).

## When
- The client issues each of the following requests in order:
  1. `curl -fsS -i -X DELETE http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<A>`             # first close
  2. `curl -fsS -i        http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<A>`                # post-close detail
  3. `curl -fsS -i        http://127.0.0.1:<port>/gateways/hermes/sessions`                       # post-close listing
  4. `curl -fsS -i -X DELETE http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<A>`             # second close (idempotency)
  5. `curl -sS  -i -X DELETE http://127.0.0.1:<port>/gateways/hermes/sessions/ses_DOES_NOT_EXIST`  # unknown id
  6. `curl -sS  -i -X DELETE http://127.0.0.1:<port>/gateways/does-not-exist/sessions/ses_<A>`     # unknown gateway
  7. `curl -fsS -i        http://127.0.0.1:<port>/gateways/hermes`                                # gateway counter

## Then
- **Request 1 (first close)** — HTTP `204 No Content`. Per RFC 7230, the response has **no body** and the server emits no `Content-Length: 0` body bytes (`Content-Length: 0` header is allowed; `Transfer-Encoding: chunked` is not). No `Content-Type` header is required for 204.
- **Request 2 (post-close detail)** — HTTP `200 OK`, body is a `@sumeru/session` envelope with:
  ```json
  {
    "type": "@sumeru/session",
    "value": {
      "id": "ses_<A>",
      "gateway": "hermes",
      "status": "closed",
      "createdAt": "<iso>",
      "config": <original config>
    }
  }
  ```
  - `status` flipped from `"idle"` to `"closed"`. The session record itself is **kept** in the in-memory store — close is a status flip, not a removal. (Required by issue's completion criterion: "关闭后仍可查询（status=closed）".)
  - `createdAt` is unchanged. `config` round-trips unchanged.
  - There is no `closedAt` field in Phase 2 (out of scope; introduce if needed in a later phase).
- **Request 3 (listing after close)** — HTTP `200`, the closed session still appears in `value`, with `status: "closed"`. The list never filters out closed sessions in Phase 2.
- **Request 4 (second close — idempotency)** — HTTP `204 No Content`. Re-closing a `closed` session is a **no-op success**, NOT a 404 and NOT a 409. This matches typical REST semantics for delete idempotency and lets clients retry safely.
- **Request 5 (unknown session id)** — HTTP `404 Not Found`, `Content-Type: application/json...`, body is a `@sumeru/error` envelope with `value.error: "session_not_found"` and a message naming the requested id. (Same code as `GET .../sessions/:id` 404.)
- **Request 6 (unknown gateway)** — HTTP `404`, `@sumeru/error` envelope with `value.error: "gateway_not_found"`. The gateway check runs before the session lookup, identical to the GET flow.
- **Request 7 (gateway counter)** — `GET /gateways/hermes` returns `activeSessions: <count of non-closed sessions>`. Closed sessions do NOT contribute to `activeSessions`. After Request 1, if A was the only session on `hermes`, `activeSessions` is `0`.
- **Trailing slash** — `DELETE /gateways/hermes/sessions/ses_<A>/` is normalized identically to `DELETE /gateways/hermes/sessions/ses_<A>` (returns the same `204` or `404` based on state).
- **No request body** — `DELETE` requests with a body are accepted; the body is ignored. (Phase 2 does not introduce a delete-with-payload variant.)
- **Phase-2 scope** — Closing the session does NOT (yet) call into any adapter. Adapter-level `close(nativeRef)` lands in a later phase when real agents are wired up. The Phase-2 close is purely a status flip on the in-memory record.
- **Concurrency note** — The 409 covered in `server-session-status-state-machine.md` only fires while a session is `active` (i.e. processing an in-flight message). In Phase 2 there is no message endpoint yet, so the practical state surface is `idle ↔ closed`; 409 paths are reserved and stubbed in the implementation. (The 409 contract is fully specified in the state-machine spec so callers know what to expect when message endpoints land.)
- All Phase-1 and Phase-2 GET / POST behaviors continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. Tests cover: success 204 + status flip, idempotent re-close 204, unknown-id 404, unknown-gateway 404, post-close detail still returns 200 with `closed`, post-close listing still includes the entry, and the gateway counter decrements.
