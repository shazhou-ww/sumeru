---
scenario: "Sumeru-managed session IDs use the prefix `ses_` followed by a 26-char ULID; callers never see agent-native IDs"
feature: server-http
tags: [http, session, id, ulid, phase-2]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares a `hermes` gateway (Phase-1 config, see `server-instance-endpoint-config.md`).
- No sessions exist yet for the gateway.

## When
- The client issues `curl -fsS -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:<port>/gateways/hermes/sessions` three times in succession (creating sessions A, B, C).
- The client lists sessions: `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions`.

## Then
- Each `POST` response body is a `@sumeru/session` envelope whose `value.id` matches the regex `^ses_[0-9A-HJKMNP-TV-Z]{26}$`:
  - Always begins with the literal prefix `ses_`.
  - Followed by exactly 26 characters from Crockford Base32 (digits + uppercase A–Z, excluding I, L, O, U).
  - The 26-char body is a valid ULID — its first 10 chars decode to a millisecond timestamp ≤ "now" + 5 s.
- `value.id` is generated **server-side**. The request body never carries an `id` field; if the client sends one it is ignored (the server still returns its own `ses_…` ID).
- The three returned IDs `A.id`, `B.id`, `C.id` are **distinct**. There is no collision across sessions on the same gateway, on different gateways, or across server restarts (ULID monotonicity is sufficient — implementation may use the monotonic-ULID variant).
- IDs are **case-sensitive**. The 26-char body is uppercase as emitted; a `GET /gateways/hermes/sessions/<lowercased-id>` returns `404 session_not_found`.
- The `value.id` field is the **only** session identifier exposed through the HTTP API. The response never contains an `agentSessionId`, `nativeId`, `hermesSessionId`, or any other agent-native identifier — those are an internal mapping detail.
- The session ID returned by `POST` matches the `value.id` of the same session in the subsequent `GET /gateways/hermes/sessions` list and `GET /gateways/hermes/sessions/:id` detail responses.
- The implementation lives in `@sumeru/server` (e.g. `src/session/id.ts` exporting a `generateSessionId(): string` pure function). Unit tests exercise the regex shape, the prefix, the length (30 chars total: 4 prefix + 26 body), and that 1000 sequential calls produce 1000 distinct values.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
