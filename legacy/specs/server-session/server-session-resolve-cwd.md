---
scenario: "POST /gateways/:name/sessions resolves config.cwd against the instance workspaceRoot, passes the resolved absolute path to adapter.createSession, and persists the resolution to ocas session-meta"
feature: server-http
tags: [http, session, create, cwd, workspace-root, adapter, ocas, phase-6, issue-27]
---

## Given
- The branch `fix/27-workspace-root-session-cwd` is checked out and the prior spec `config-load-workspace-root.md` is implemented (`InstanceConfig.workspaceRoot: string | null`).
- `ServerConfig` (and `StartConfig`) now carry a `workspaceRoot: string | null` field plumbed through `startServer` from the CLI.
- A new exported helper lives at `packages/server/src/session/cwd.ts`:
  ```typescript
  export function resolveSessionCwd(
    workspaceRoot: string | null,
    rawCwd: unknown,
  ): { ok: true; cwd: string | null } | { ok: false; message: string };
  ```
  This is the single source of truth for the resolution rules below — both the HTTP handler and tests import it from there.
- The `Session` and `SessionWire` types add **no** new fields. The opaque `config` blob continues to round-trip verbatim — the **resolved** cwd lives in adapter `meta` (and in `@sumeru/session-meta` ocas), not in the wire envelope.
- A two-gateway fixture `packages/server/tests/fixtures/sumeru.workspace-root.yaml` declares:
  ```yaml
  name: sumeru@test
  workspaceRoot: /tmp/sumeru-ws
  gateways:
    hermes:
      adapter: hermes
      capabilities: { resume: true, streaming: true }
    claude-code:
      adapter: claude-code
      capabilities: { resume: true, streaming: false }
  ```
- Tests use the existing `stub-adapter.ts` (or a small extension of it) that records the `config` argument passed to `adapter.createSession` so assertions can read back the exact value the server forwarded.

## When
- The server is started via `startServer({ workspaceRoot: "/tmp/sumeru-ws", ... })` (or by loading the fixture above through the CLI).
- The client issues, against the running server:
  1. `POST /gateways/hermes/sessions` with `{"config":{"cwd":"project-a"}}` (relative single-segment cwd).
  2. `POST /gateways/hermes/sessions` with `{"config":{"cwd":"team/project-b"}}` (relative multi-segment cwd).
  3. `POST /gateways/hermes/sessions` with `{"config":{}}` (no cwd at all — empty config object).
  4. `POST /gateways/hermes/sessions` with `{"config":{"cwd":"/tmp/sumeru-ws/abs-project"}}` (absolute path AND workspaceRoot configured).
  5. `POST /gateways/hermes/sessions` with `{"config":{"cwd":"../escape"}}` (path tries to escape workspaceRoot).
  6. `POST /gateways/hermes/sessions` with `{"config":{"cwd":42}}` (wrong type).
  7. The same six requests are repeated against a server started with `workspaceRoot: null` (no workspace configured).

## Then
- **Resolution rules implemented in `resolveSessionCwd`:**
  - If `rawCwd` is `undefined` or `null` → `{ ok: true, cwd: null }` (no cwd hint to the adapter).
  - If `rawCwd` is the empty string → `{ ok: true, cwd: null }` (treated identical to absent, mirroring `workspaceRoot: ""`).
  - If `rawCwd` is not a string and not absent → `{ ok: false, message: "config.cwd must be a string" }`.
  - If `rawCwd` is a non-empty string AND `workspaceRoot !== null`:
    - Resolved cwd is `path.resolve(workspaceRoot, rawCwd)` — `path.resolve` handles both relative segments (`project-a`) and absolute inputs (latter wins by Node convention).
    - **Confinement check:** the resolved path must be either equal to `workspaceRoot` or a descendant (`resolved.startsWith(workspaceRoot + path.sep)`). If not, return `{ ok: false, message: "config.cwd '<raw>' resolves outside workspaceRoot '<root>'" }`.
  - If `rawCwd` is a non-empty string AND `workspaceRoot === null`:
    - The raw value MUST be an absolute path (`path.isAbsolute`). If absolute, return `{ ok: true, cwd: rawCwd }` verbatim (no resolution needed). If relative, return `{ ok: false, message: "config.cwd '<raw>' must be absolute when no workspaceRoot is configured" }`. This is the documented "fallback" mode from the issue.
- **HTTP behavior** — `POST /gateways/:name/sessions` calls `resolveSessionCwd(serverConfig.workspaceRoot, body.config?.cwd)` BEFORE invoking the adapter:
  - On `{ ok: false }` — respond `400 Bad Request` with `@sumeru/error` envelope, `value.error: "invalid_cwd"` and `value.message` carrying the helper's message. **No** session is created (subsequent `GET .../sessions` does not list it). **No** `adapter.createSession` call is made.
  - On `{ ok: true, cwd }` — the server augments the opaque config it forwards to the adapter as follows:
    - It calls `adapter.createSession({ ...originalConfig, cwd: resolvedCwd })` — the adapter sees the **resolved absolute path** (or `null`) under the well-known key `cwd`. The original `cwd` field in the user-supplied config is replaced; other keys round-trip untouched.
    - The Sumeru `Session.config` field stored in memory and returned in the 201 envelope is the **original** opaque blob exactly as the client sent it (e.g. `{"cwd":"project-a"}` for case 1) — the wire contract from `server-session-create-endpoint.md` is unchanged. Only the adapter sees the resolved form.
- **Per-case expectations (workspaceRoot=/tmp/sumeru-ws):**
  | # | Body | HTTP | Adapter receives `config.cwd` |
  |---|------|------|-------------------------------|
  | 1 | `{"cwd":"project-a"}` | 201 | `/tmp/sumeru-ws/project-a` |
  | 2 | `{"cwd":"team/project-b"}` | 201 | `/tmp/sumeru-ws/team/project-b` |
  | 3 | `{}` | 201 | `null` (key omitted) |
  | 4 | `{"cwd":"/tmp/sumeru-ws/abs-project"}` | 201 | `/tmp/sumeru-ws/abs-project` |
  | 5 | `{"cwd":"../escape"}` | 400 invalid_cwd | (adapter NOT called) |
  | 6 | `{"cwd":42}` | 400 invalid_cwd | (adapter NOT called) |
- **Per-case expectations (workspaceRoot=null):**
  | # | Body | HTTP | Adapter receives `config.cwd` |
  |---|------|------|-------------------------------|
  | 1 | `{"cwd":"project-a"}` | 400 invalid_cwd | (adapter NOT called) |
  | 2 | `{"cwd":"team/project-b"}` | 400 invalid_cwd | (adapter NOT called) |
  | 3 | `{}` | 201 | `null` (key omitted) |
  | 4 | `{"cwd":"/tmp/sumeru-ws/abs-project"}` | 201 | `/tmp/sumeru-ws/abs-project` (used verbatim — caller is responsible) |
  | 5 | `{"cwd":"../escape"}` | 400 invalid_cwd | (adapter NOT called) |
  | 6 | `{"cwd":42}` | 400 invalid_cwd | (adapter NOT called) |
- **ocas session-meta carries the resolved cwd** — the `@sumeru/session-meta` node written by `recordPayload(...)` for a successful create now contains a top-level `resolvedCwd: string | null` field (in addition to the existing `id`, `gateway`, `adapter`, `createdAt`, `config`). The original opaque `config` is preserved unchanged inside the meta node. The schema's registered `type` hash is bumped (the schema body now lists `resolvedCwd` as a required field), and `SUMERU_SESSION_META_SCHEMA` exports the new shape from `@sumeru/server`.
- **Wire envelope unchanged** — the 201 response body still has exactly the five `value` keys (`id`, `gateway`, `status`, `createdAt`, `config`) defined in `server-session-create-endpoint.md`. `resolvedCwd` does NOT leak into the HTTP envelope; it is an internal/ocas-only detail.
- **Method enforcement & 404 priorities** — pre-existing behavior is unchanged: unknown gateway → 404 `gateway_not_found`; malformed JSON → 400 `invalid_json`; non-object body → 400 `invalid_request`. The new `invalid_cwd` 400 fires AFTER those checks (so a malformed-JSON `{"cwd":` still returns `invalid_json`, not `invalid_cwd`).
- **Wide-test integration** — the existing test suite for the create-endpoint (`server-session-create-endpoint.md`) continues to pass byte-identically when `workspaceRoot` is `null` AND the request body has no `config.cwd` — i.e. the new feature is strictly additive for clients that don't opt in.
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit 0. The new helper is unit-tested in `packages/server/tests/cwd.test.ts` (covering all branches above) and the HTTP behavior is integration-tested in `packages/server/tests/sessions-create-cwd.test.ts`.
