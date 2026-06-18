---
scenario: "Session status follows the state machine `idle → active → idle | closed`; transitions are enforced server-side and concurrent send returns 409"
feature: server-http
tags: [http, session, status, state-machine, concurrency, 409, phase-2]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares a `hermes` gateway.
- The `@sumeru/server` package exposes an internal session store (e.g. `src/session/store.ts`) with a typed `SessionStatus` and helpers for the transitions enumerated below.

## When
- The implementation defines `SessionStatus = "idle" | "active" | "closed"` (type) and a transition table with these allowed edges and no others:
  - `(none) → idle`            — on create (`POST /gateways/:name/sessions`)
  - `idle → active`             — on send-start (reserved for the future `POST .../sessions/:id/messages` endpoint; not exposed in Phase 2 but the helper exists)
  - `active → idle`             — on send-finish (success or non-fatal error)
  - `idle → closed`             — on `DELETE /gateways/:name/sessions/:id`
  - `active → closed`           — on `DELETE` while active (Phase 2: not exercised over HTTP because no message endpoint exists yet, but the helper accepts it for forward compat with Phase 3)
  - `closed → closed`           — idempotent `DELETE` no-op (see `server-session-delete-endpoint.md`)
- Any other transition is **rejected**: e.g. `closed → idle`, `closed → active`, `idle → idle` (re-open), `active → active` (concurrent send).

## Then
- **Type definition** — `packages/core/src/types.ts` (or `packages/server/src/session/types.ts`) exports `type SessionStatus = "idle" | "active" | "closed"` (string-literal union, no enum, per project conventions). The `Session` value shape exported alongside has `status: SessionStatus`.
- **Initial status** — Every session returned from `POST /gateways/:name/sessions` has `value.status === "idle"`. (See `server-session-create-endpoint.md`.)
- **Closed terminal** — Once a session is `closed`, no HTTP operation can return it to `idle` or `active`. Calling `DELETE` on a closed session yields `204` (idempotent no-op). There is no "reopen" endpoint in Phase 2; if such an operation is attempted via internal store helpers it throws an `Error` with a stable message like `Invalid transition: closed → idle`.
- **Concurrency contract — the 409** — While a session's status is `active`, attempting to start a second concurrent operation on it MUST return:
  ```
  HTTP/1.1 409 Conflict
  Content-Type: application/json; charset=utf-8

  {
    "type": "@sumeru/error",
    "value": {
      "error": "session_busy",
      "message": "Session ses_<id> on gateway <name> is currently active"
    }
  }
  ```
  - `value.error` is the stable code `session_busy`.
  - In Phase 2 the only operation that could provoke this is the future message-send endpoint; since that endpoint does not exist yet, the 409 path is **unit-tested via the store helper** rather than over HTTP. The store helper exposes a `tryActivate(id): { ok: true } | { ok: false, reason: "busy" | "closed" | "not_found" }` (or equivalent) so subsequent phases can wire it to the message endpoint without re-litigating the contract.
- **State-machine helper API** — The store exposes pure functions that take a `Session` and return either a new `Session` with a different `status` or a typed error. Examples:
  - `markActive(session): { ok: true, session } | { ok: false, reason: "busy" | "closed" }`
  - `markIdle(session): { ok: true, session } | { ok: false, reason: "not_active" }`
  - `markClosed(session): { ok: true, session } | { ok: false, reason: "already_closed" }`  ← but the HTTP DELETE endpoint translates `already_closed` into idempotent 204, NOT 409.
- **No timing assumptions** — Status is purely event-driven. There is no "auto-idle after N seconds" timer; an `active` session stays `active` until the operation that activated it concludes. In Phase 2, since there is no activator, every session reachable over HTTP is either `idle` or `closed`.
- **Counter rule** — `GET /gateways/:name`'s `activeSessions` field counts sessions whose status is **not** `closed` (i.e. `idle` + `active`). After every state transition the counter is consistent without further calls.
- **Wire shape** — In every place a session is serialized over HTTP (`POST` 201, `GET` listing, `GET` detail), `status` is one of the literal strings `"idle"`, `"active"`, `"closed"`. No other values appear; an unknown internal status is a server bug and is unit-tested to fail typecheck.
- **Tests** — Vitest cases under `packages/server/tests/session-status.test.ts` (or similar) exercise:
  - All allowed transitions return a new session with the expected status.
  - Each disallowed transition returns the documented `ok: false` reason and does NOT mutate the input.
  - `tryActivate` on an already-`active` session returns `reason: "busy"` (the future 409 path).
  - `tryActivate` on a `closed` session returns `reason: "closed"` (the future 404 path — closed sessions can't accept new messages).
  - `markIdle` on a non-`active` session returns `reason: "not_active"`.
- **Forward-compat** — When the message-send endpoint lands in a later phase, it MUST translate state-machine results into HTTP codes as follows: `busy → 409 session_busy`, `closed → 404 session_not_found` (or equivalent — to be specified when that endpoint is specced), `not_found → 404 session_not_found`. The state-machine spec defines the contract; the message-endpoint spec defines the wire mapping.
- All Phase-1 and Phase-2 endpoint behaviors continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
