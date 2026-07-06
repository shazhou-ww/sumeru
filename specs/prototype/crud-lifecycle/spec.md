---
scenario: Prototype CRUD lifecycle — create, read, update, delete YAML-file-based prototypes
feature: Prototype Management
tags: [prototype, crud, yaml, validation]
---

# Prototype CRUD Lifecycle

## Prototype 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✓ | From URL path, unique identifier |
| persona | string | ✓ | Must reference existing Persona in SQLite |
| model | string\|null | conditional | Format "provider:name"; must exist in SQLite. Null only if adapter.providerMode === "builtin-only" |
| adapter | string | ✓ | Must reference existing adapter in adapter registry |
| extensions | string[]\|null | ✗ | Each must reference existing Extension in hostConfig.extensions |
| image | string\|null | ✗ | Docker image override |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /prototypes | List all prototypes |
| GET | /prototypes/:name | Get single prototype |
| PUT | /prototypes/:name | Create or update (upsert) |
| DELETE | /prototypes/:name | Remove prototype |

### 响应信封

```json
{ "type": "@sumeru/prototype-list", "value": [...] }
{ "type": "@sumeru/prototype", "value": { "name": "...", "persona": "...", "model": "...", "adapter": "...", "extensions": [...], "image": null } }
```

---

## Given
- Host is running and healthy
- SQLite contains Persona "coder" and Model "openai:gpt-4"
- Adapter registry contains adapter "docker"
- hostConfig.extensions contains "mcp-filesystem"

## When — list prototypes (empty)
```bash
curl -s http://localhost:3000/prototypes
```

## Then — 200 empty list
```json
{ "type": "@sumeru/prototype-list", "value": [] }
```

---

## When — create prototype via PUT
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"docker","extensions":["mcp-filesystem"]}'
```

## Then — 201 created
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "extensions": ["mcp-filesystem"], "image": null } }
```

---

## When — get prototype
```bash
curl -s http://localhost:3000/prototypes/my-agent
```

## Then — 200 prototype detail
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "extensions": ["mcp-filesystem"], "image": null } }
```

---

## When — update prototype (merge)
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic:claude-3"}'
```

## Then — 200 updated (merged fields)
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "anthropic:claude-3", "adapter": "docker", "extensions": ["mcp-filesystem"], "image": null } }
```

---

## When — delete prototype
```bash
curl -s -X DELETE http://localhost:3000/prototypes/my-agent
```

## Then — 204 No Content

---

## When — get deleted prototype
```bash
curl -s http://localhost:3000/prototypes/my-agent
```

## Then — 404
```json
{ "type": "@sumeru/error", "value": { "code": "prototype_not_found", "message": "Prototype not found" } }
```

---

## When — create with nonexistent persona
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"nonexistent","model":"openai:gpt-4","adapter":"docker"}'
```

## Then — 400 persona_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "persona_not_found", "message": "Persona not found" } }
```

---

## When — create with nonexistent adapter
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"nonexistent"}'
```

## Then — 400 adapter_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "adapter_not_found", "message": "Adapter not found" } }
```

---

## When — create with invalid model format
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"invalid-format","adapter":"docker"}'
```

## Then — 400 model_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "model_not_found", "message": "Model not found" } }
```

---

## When — create with null model on non-builtin-only adapter
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":null,"adapter":"docker"}'
```

## Then — 400 model_required
```json
{ "type": "@sumeru/error", "value": { "code": "model_required", "message": "Model is required for this adapter" } }
```

---

## When — create with nonexistent extension
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"docker","extensions":["nonexistent"]}'
```

## Then — 400 extension_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "extension_not_found", "message": "Extension not found" } }
```

---

## When — PUT with YAML body
```bash
curl -s -X PUT http://localhost:3000/prototypes/yaml-agent \
  -H "Content-Type: application/yaml" \
  -d 'persona: coder
model: openai:gpt-4
adapter: docker'
```

## Then — 201 created
```json
{ "type": "@sumeru/prototype", "value": { "name": "yaml-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "extensions": null, "image": null } }
```

---

## Notes
- Prototypes are stored as YAML files on disk (not SQLite)
- PUT is upsert: 201 for new, 200 for existing (merge semantics on update)
- On create failure (e.g. compose validation), the YAML file is rolled back (deleted)
- Model null is allowed only when adapter.providerMode === "builtin-only"
- CLI: `sumeru prototype list/get/add/update/remove`
