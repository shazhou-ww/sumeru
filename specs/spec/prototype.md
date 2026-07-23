# Prototype CRUD Lifecycle

> atest: [`prototype-crud.test.yaml`](../atest/prototype-crud.test.yaml)

## Prototype 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✓ | From URL path, unique identifier |
| persona | string | ✓ | Must reference existing Persona in SQLite |
| model | string\|null | conditional | Format "provider:name"; must exist in SQLite. Null only if adapter.providerMode === "builtin-only" |
| adapter | string | ✓ | Must reference existing adapter in adapter registry |
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
{ "type": "@sumeru/prototype", "value": { "name": "...", "persona": "...", "model": "...", "adapter": "...", "image": null } }
```

---

## Scenario: 列出所有 Prototype

**When** `GET /prototypes`

**Then** 200，返回 `@sumeru/prototype-list`

**Then** 每项包含 name、persona、model、adapter

---

## Scenario: 创建 Prototype

**Given** Host is running and healthy

**Given** SQLite contains Persona "coder" and Model "openai:gpt-4"

**Given** Adapter registry contains adapter "docker"

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"docker"}'
```

**Then** 201 created
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "image": null } }
```

---

## Scenario: 获取 Prototype

**When** `GET /prototypes/my-agent`

**Then** 200 prototype detail
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "image": null } }
```

---

## Scenario: 更新 Prototype (merge)

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic:claude-3"}'
```

**Then** 200 updated (merged fields)
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "anthropic:claude-3", "adapter": "docker", "image": null } }
```

---

## Scenario: 删除 Prototype

**When** `DELETE /prototypes/my-agent`

**Then** 204 No Content

**When** `GET /prototypes/my-agent`

**Then** 404 `prototype_not_found`

---

## Scenario: 创建时 Persona 不存在

**Given** Persona "nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"nonexistent","model":"openai:gpt-4","adapter":"docker"}'
```

**Then** 400 `persona_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "persona_not_found", "message": "Persona not found" } }
```

---

## Scenario: 创建时 Adapter 不存在

**Given** Adapter "nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"nonexistent"}'
```

**Then** 400 `adapter_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "adapter_not_found", "message": "Adapter not found" } }
```

---

## Scenario: 创建时 Model 不存在

**Given** Model "openai:nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:nonexistent","adapter":"docker"}'
```

**Then** 400 `model_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "model_not_found", "message": "Model not found" } }
```

---

## Scenario: 非 builtin-only Adapter 时 Model 为 null

**Given** Adapter "docker" 的 providerMode === "custom-only"

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":null,"adapter":"docker"}'
```

**Then** 400 `model_required`
```json
{ "type": "@sumeru/error", "value": { "code": "model_required", "message": "Model is required for this adapter" } }
```

---

## Scenario: builtin-only Adapter 时 Model 为 null

**Given** Adapter "claude-code" 的 providerMode === "builtin-only"

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":null,"adapter":"claude-code"}'
```

**Then** 201 created（model 为 null 合法）
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": null, "adapter": "claude-code", "image": null } }
```

---

## Notes
- Prototypes are stored as YAML files on disk (not SQLite)
- PUT is upsert: 201 for new, 200 for existing (merge semantics on update)
- On create failure (e.g. compose validation), the YAML file is rolled back (deleted)
- Model null is allowed only when adapter.providerMode === "builtin-only"
- CLI: `sumeru prototype list/get/add/update/remove`