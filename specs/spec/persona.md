# Persona 完整 CRUD 生命周期

> atest: [`persona-crud.test.yaml`](../atest/persona-crud.test.yaml)

Persona 是 Agent 角色配置（SQLite 实体，Phase 2 新增）。Persona = pure system prompt text.

## Persona 字段

```json
{
  "name": "general",
  "instructions": "A general-purpose coding agent.",
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | 唯一标识，来自 URL `:name` |
| instructions | string | ✅ | Agent 指令文本（system prompt） |
| createdAt | string | auto | ISO 8601 创建时间 |
| updatedAt | string | auto | ISO 8601 更新时间 |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /personas | 列出所有 |
| GET | /personas/:name | 单个详情 |
| PUT | /personas/:name | upsert（201 新建 / 200 替换 / 400） |
| DELETE | /personas/:name | 删除（204 / 404 / 409） |

### PUT Body

```json
{
  "instructions": "Your system prompt text here."
}
```

PUT 使用 merge 语义 — 省略的字段保留现有值。

### 删除保护

删除 Persona 时若有 Prototype 引用它（YAML `persona:` 字段），返回 `409 persona_in_use`。

### 响应信封

```json
{ "type": "@sumeru/persona", "value": { ... } }
{ "type": "@sumeru/persona-list", "value": [ ... ] }
```

---

## Scenario: 列出所有 Persona

**When** `GET /personas`

**Then** 200，返回 `@sumeru/persona-list`

**Then** 每项包含 name、instructions（前 100 字符）

---

## Scenario: 创建 Persona

**Given** Persona "coder" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/personas/coder \
  -H "Content-Type: application/json" \
  -d '{"instructions":"You are a professional software engineer."}'
```

**Then** 201 created
```json
{ "type": "@sumeru/persona", "value": { "name": "coder", "instructions": "You are a professional software engineer." } }
```

---

## Scenario: 更新 Persona (merge)

**Given** Persona "coder" 已存在

**When**
```bash
curl -s -X PUT http://localhost:3000/personas/coder \
  -H "Content-Type: application/json" \
  -d '{"instructions":"You are an expert Python developer."}'
```

**Then** 200 updated
```json
{ "type": "@sumeru/persona", "value": { "name": "coder", "instructions": "You are an expert Python developer." } }
```

---

## Scenario: 删除 Persona

**When** `DELETE /personas/coder`

**Then** 204 No Content

**When** `GET /personas/coder`

**Then** 404 `persona_not_found`

---

## Scenario: 删除被引用的 Persona

**Given** Persona "coder" 被 Prototype "my-agent" 引用

**When** `DELETE /personas/coder`

**Then** 409 `persona_in_use`
```json
{ "type": "@sumeru/error", "value": { "code": "persona_in_use", "message": "Persona coder is referenced by 1 prototype(s)" } }
```

---

## Scenario: 获取不存在的 Persona

**When** `GET /personas/nonexistent`

**Then** 404 `persona_not_found`

---

## Scenario: PUT 空 instructions

**When**
```bash
curl -s -X PUT http://localhost:3000/personas/empty \
  -H "Content-Type: application/json" \
  -d '{"instructions":""}'
```

**Then** 400 `invalid_request`
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "instructions cannot be empty" } }
```