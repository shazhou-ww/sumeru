---
id: api-reference
title: "HTTP API Reference"
sources:
  - packages/host/src/server.ts
  - packages/host/src/handlers/
  - packages/host/src/envelope.ts
  - packages/core/src/types.ts
tags: [sumeru, host, api]
created: 2026-07-02
updated: 2026-07-02
---

# HTTP API Reference

> Named entities use **PUT upsert** (201 create / 200 update). Sessions use **POST** with server-generated ID. All JSON responses use `{ type, value }` envelopes unless noted.

## Conventions

| Topic | Rule |
|-------|------|
| Response envelope | `{ "type": "@sumeru/<resource>", "value": { ... } }` |
| Error envelope | `{ "type": "@sumeru/error", "value": { "error": "<code>", "message": "<text>" } }` |
| DELETE success | `204 No Content` (no body) |
| HEAD | Matches GET routes |
| Method mismatch | `405` + `Allow` header |
| Unknown route | `404 route_not_found` |
| Model ID format | `provider:name` (e.g. `copilot:claude-opus-4.6`) |
| Model resolution | **session override > prototype.model > host.yaml `defaults.model`** |

### Session `model` field (POST body)

| Form | Example |
|------|---------|
| omitted / `null` | Resolve via prototype → defaults |
| string reference | `"copilot:claude-opus-4.6"` |
| inline override | `{ "provider": "anthropic" \| "openai" \| "openrouter" \| { "name", "endpoint", "apiType" }, "name": "..." }` |

---

## Host

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/` | — | `@sumeru/host` → `{ name, version, status: { running, queued, idle }, uptime }` | 200 |

---

## Adapters

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/adapters` | — | `@sumeru/adapter-list` → `[{ name, providerMode, credentialEnv, listModels }]` | 200 |
| GET | `/adapters/:name` | — | `@sumeru/adapter` → `{ name, providerMode, credentialEnv, listModels }` | 200, 404 |
| GET | `/adapters/:name/models` | — | `@sumeru/adapter-model-list` → `[{ id, name, contextWindow }]` | 200, 400, 404, 502 |

**GET `/adapters/:name/models` notes:** Requires adapter `credentialEnv` set in process env. Returns 404 if adapter lacks `listModels`; 400 if credential missing; 502 on upstream API failure.

---

## Providers

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/providers` | — | `@sumeru/provider-list` → `[Provider]` | 200 |
| GET | `/providers/:name` | — | `@sumeru/provider` → `Provider` | 200, 404 |
| PUT | `/providers/:name` | See below | `@sumeru/provider` → `Provider` | 201, 200, 400, 500 |
| DELETE | `/providers/:name` | — | — | 204, 404, 409, 500 |

**PUT body fields:**

| Field | Create | Update | Type |
|-------|--------|--------|------|
| `apiType` | **required** | optional | `"anthropic"` \| `"openai"` |
| `baseUrl` | optional (default `null`) | optional | `string` \| `null` |
| `apiKey` | optional | optional | `string` \| `null` |

**Provider value:** `{ name, apiType, baseUrl, apiKey, createdAt, updatedAt }`

---

## Models

Models are nested under providers. Flat list at `/models`.

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/models` | — | `@sumeru/model-list` → `[Model]` | 200 |
| GET | `/providers/:name/models` | — | `@sumeru/model-list` → `[Model]` | 200 |
| GET | `/providers/:name/models/:modelName` | — | `@sumeru/model` → `Model` | 200, 404 |
| PUT | `/providers/:name/models/:modelName` | See below | `@sumeru/model` → `Model` | 201, 200, 400, 404, 500 |
| DELETE | `/providers/:name/models/:modelName` | — | — | 204, 404, 500 |

**PUT body fields:**

| Field | Create | Update | Type | Default (create) |
|-------|--------|--------|------|------------------|
| `model` | **required** | optional | `string` (API model name) | — |
| `contextWindow` | optional | optional | `number` \| `null` | `null` |
| `toolUse` | optional | optional | `boolean` | `true` |
| `streaming` | optional | optional | `boolean` | `true` |
| `metadata` | optional | optional | `object` \| `null` | `null` |

**Model value:** `{ name, provider, model, contextWindow, toolUse, streaming, metadata, createdAt, updatedAt }`

---

## Personas

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/personas` | — | `@sumeru/persona-list` → `[Persona]` | 200 |
| GET | `/personas/:name` | — | `@sumeru/persona` → `Persona` | 200, 404 |
| PUT | `/personas/:name` | See below | `@sumeru/persona` → `Persona` | 201, 200, 400, 404, 500 |
| DELETE | `/personas/:name` | — | — | 204, 404, 409, 500 |

**PUT body fields:**

| Field | Create | Update | Type | Default (create) |
|-------|--------|--------|------|------------------|
| `instructions` | **required** | optional | `string` | — |
| `skills` | optional | optional | `string[]` | `[]` |

**Persona value:** `{ name, instructions, skills, createdAt, updatedAt }`. Referenced skills must exist (400 `skills_not_found`). Delete blocked if referenced by prototype (409 `persona_in_use`).

---

## Prototypes

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/prototypes` | — | `@sumeru/prototype-list` → `[Prototype]` | 200 |
| GET | `/prototypes/:name` | — | `@sumeru/prototype` → `Prototype` | 200, 404 |
| PUT | `/prototypes/:name` | See below | `@sumeru/prototype` → `Prototype` | 201, 200, 400, 500 |
| DELETE | `/prototypes/:name` | — | — | 204, 404, 500 |

**PUT body:** JSON (`Content-Type: application/json`) or raw YAML. Path param `:name` is authoritative.

**Create fields (all in body):**

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `name` | **yes** | `string` | Must match `:name` path param |
| `persona` | **yes** | `string` | Must exist in SQLite |
| `adapter` | **yes** | `string` | Must be registered adapter |
| `model` | no | `string` \| `null` | `provider:name`; required unless adapter is `builtin-only` |
| `extensions` | no | `string[]` \| `null` | Each extension must exist |
| `defaults` | no | object \| `null` | `{ maxTurns, timeout, resources: { cpu, memory } }` |

**Update fields:** Any subset of `persona`, `model`, `adapter`, `extensions`, `defaults` (partial merge).

**Prototype value:** `{ name, persona, model, adapter, extensions, defaults }`

---

## Extensions

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/extensions` | — | `@sumeru/extension-list` → `[Extension]` | 200 |
| GET | `/extensions/:name` | — | `@sumeru/extension` → `Extension` | 200, 404 |
| PUT | `/extensions/:name` | See below | `@sumeru/extension` → `Extension` | 201, 200, 400, 500 |
| DELETE | `/extensions/:name` | — | — | 204, 404, 500 |

**PUT body fields:**

| Field | Create | Update | Type | Default (create) |
|-------|--------|--------|------|------------------|
| `dockerfile` | **required** | optional | `string` | — |
| `description` | optional | optional | `string` | `""` |

**Extension value:** `{ name, description, dockerfile, createdAt, updatedAt }`

---

## Skills

No list endpoint. Skills are referenced by name from personas.

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/skills/:name` | — | `@sumeru/skill` → `{ name, content }` | 200, 404 |
| PUT | `/skills/:name` | See below | `@sumeru/skill` → `{ name, content }` | 200, 400, 500 |
| DELETE | `/skills/:name` | — | — | 204, 404, 409 |

**PUT body:** Plain text, or JSON `{ "content": "<string>" }`.

Delete blocked if referenced by persona (409 `skill_referenced`).

---

## Sessions

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/sessions` | — | `@sumeru/session-list` → `[SessionInfo]` | 200 |
| POST | `/sessions` | See below | `@sumeru/session` → `SessionInfo` | 201, 400, 404, 500 |
| GET | `/sessions/:id` | — | `@sumeru/session` → `SessionInfo` | 200, 404 |
| POST | `/sessions/:id/stop` | — | `@sumeru/session` → `SessionInfo` | 200, 404, 409, 500 |
| DELETE | `/sessions/:id` | — | — | 204, 404, 500 |
| POST | `/sessions/:id/messages` | See below | `@sumeru/message-accepted` → `{ sessionId, messageId }` | 202, 400, 404, 409, 503, 500 |
| GET | `/sessions/:id/events` | — | SSE stream (not JSON envelope) | 200, 404, 410, 500 |
| GET | `/sessions/:id/history` | — | `@sumeru/history` → `{ sessionId, total, offset, turns }` | 200, 400, 404 |
| GET | `/sessions/:id/turns` | — | `@sumeru/turn-list` → `[Turn]` | 200, 400, 404 |
| POST | `/sessions/:id/export` | — | `application/gzip` binary (`.ndjson.gz`) | 200, 404, 500 |

**POST `/sessions` body:**

| Field | Required | Type |
|-------|----------|------|
| `prototype` | **yes** | `string` |
| `project` | **yes** | `string` (workspace-relative path) |
| `task` | **yes** | `string` |
| `model` | no | `string` \| inline object \| `null` |
| `env` | no | `Record<string, string>` \| `null` |

**POST `/sessions/:id/messages` body:**

| Field | Required | Type |
|-------|----------|------|
| `content` | **yes** | `string` |
| `env` | no | `Record<string, string>` \| `null` |
| `model` | no | Same forms as session create |

**SessionInfo value:** `{ id, prototype, model, image, project, task, status, exit, tokenUsage, createdAt }`. `model.apiKey` is masked in responses.

**GET `/sessions/:id/history` query:** `limit` (default 100, max 1000), `offset` (default 0).

**GET `/sessions/:id/turns` query:** `after` (optional non-negative integer cursor).

**GET `/sessions/:id/events`:** SSE with `Last-Event-ID` replay. Heartbeat comments every 15s. `410 sse_buffer_expired` if replay ID stale.

---

## Search

| Method | Path | Request Body | Response Envelope | Status Codes |
|--------|------|--------------|-------------------|--------------|
| GET | `/search` | — | `@sumeru/search` → `{ query, hits }` | 200, 400 |

**Query params:**

| Param | Required | Type | Notes |
|-------|----------|------|-------|
| `q` | **yes** | `string` | Search term |
| `session` | no | `string` | Filter to one session ID |

**Hit value:** `{ sessionId, turn: { timestamp, type, value, hash }, highlight }`

---

## Error Codes (common)

| Code | HTTP | When |
|------|------|------|
| `route_not_found` | 404 | Unknown path |
| `method_not_allowed` | 405 | Wrong HTTP method |
| `invalid_body` / `invalid_request` / `invalid_json` | 400 | Malformed input |
| `*_not_found` | 404 | Entity missing |
| `*_in_use` / `skill_referenced` / `session_busy` / `session_already_idle` | 409 | Conflict |
| `adapter_unavailable` / `session_not_running` | 503 | Session/adapter not ready |
| `internal_error` | 500 | Unexpected failure |

---

## See Also

- [Host HTTP Service](./host-service.md) — architecture and route overview
- [CLI Command Reference](./cli-reference.md) — CLI wrapper for these endpoints
- [SSE Reliability](./sse-reliability.md) — events stream behavior
