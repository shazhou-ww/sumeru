---
scenario: Prototype 完整 CRUD 生命周期
feature: Prototype CRUD API
tags: [prototype, crud, lifecycle]
---

# Prototype 完整 CRUD 生命周期

Prototype 是 Worker Agent 的配置模板。Phase 2 重构后 Prototype 引用 Persona 和 Model（均为 SQLite 实体），不再内联 instructions/skills。

## Prototype 字段

```yaml
name: hermes           # 唯一标识，匹配 URL 路径参数
persona: general       # 引用 Persona.name（SQLite）
model: claude-sonnet   # 引用 Model.id（SQLite）
image: sumeru-worker   # Docker image 名称
defaults:              # 可选
  maxTurns: 30
  timeout: 300
  resources:
    cpu: 2
    memory: "4Gi"
```

### 创建/更新校验

- `persona` 必须在 SQLite 中存在 → 400 `persona_not_found`
- `model` 必须在 SQLite 中存在 → 400 `model_not_found`
- `name` 必须匹配 URL 中的 `:name` → 400 `invalid_body`
- `image` 必须为非空 string

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /prototypes | 列出所有 |
| GET | /prototypes/:name | 单个详情 |
| POST | /prototypes/:name | 创建（201 / 409） |
| PUT | /prototypes/:name | 更新（200 / 404） |
| DELETE | /prototypes/:name | 删除（204 / 404） |

### 响应信封

列表：
```json
{
  "type": "@sumeru/prototype-list",
  "value": [
    {
      "name": "hermes",
      "prototype": {
        "name": "hermes",
        "persona": "general",
        "model": "claude-sonnet",
        "image": "sumeru-worker:latest",
        "defaults": null
      },
      "yamlPath": "/path/to/prototypes/hermes.yaml",
      "prototypeHash": "abc123...",
      "composePath": "/path/to/prototypes/hermes/compose.yaml"
    }
  ]
}
```

单个：
```json
{
  "type": "@sumeru/prototype",
  "value": { ... }
}
```

注意：响应中 `value` 是 `PrototypeInfo`，包含 `name`, `prototype`, `yamlPath`, `prototypeHash`, `composePath`。
`prototype` 子对象才是 Prototype 本体。

---

## Scenario: 列出所有 Prototype

**When** `GET /prototypes`

**Then** 200，返回 `@sumeru/prototype-list`，每项含 `name`, `prototype`, `yamlPath`, `prototypeHash`, `composePath`

---

## Scenario: 获取单个 Prototype 详情

**When** `GET /prototypes/hermes`

**Then** 200，返回 `@sumeru/prototype`

**When** `GET /prototypes/nonexistent`

**Then** 404，`prototype_not_found`

---

## Scenario: 创建 Prototype

**Given** Persona `general` 和 Model `claude-sonnet` 均已存在于 SQLite

**When** `POST /prototypes/new-agent`

```json
{
  "name": "new-agent",
  "persona": "general",
  "model": "claude-sonnet",
  "image": "sumeru-worker:latest"
}
```

**Then** 201，返回 `@sumeru/prototype`

**When** 再次 `POST /prototypes/new-agent`（同名）

**Then** 409，`prototype_exists`

---

## Scenario: 创建引用不存在 Persona 的 Prototype

**When** `POST /prototypes/bad-persona`

```json
{
  "name": "bad-persona",
  "persona": "nonexistent",
  "model": "claude-sonnet",
  "image": "sumeru-worker:latest"
}
```

**Then** 400，`persona_not_found`

---

## Scenario: 创建引用不存在 Model 的 Prototype

**When** `POST /prototypes/bad-model`

```json
{
  "name": "bad-model",
  "persona": "general",
  "model": "nonexistent",
  "image": "sumeru-worker:latest"
}
```

**Then** 400，`model_not_found`

---

## Scenario: 更新 Prototype

**Given** 已存在 prototype `update-target`

**When** `PUT /prototypes/update-target`

```json
{
  "name": "update-target",
  "persona": "general",
  "model": "claude-sonnet",
  "image": "sumeru-worker:v2"
}
```

**Then** 200，`value.prototype.image` = `sumeru-worker:v2`

---

## Scenario: 删除 Prototype

**When** `DELETE /prototypes/to-delete`

**Then** 204

**When** 再 `GET /prototypes/to-delete`

**Then** 404

---

## Scenario: 删除不存在 Prototype

**When** `DELETE /prototypes/ghost`

**Then** 404，`prototype_not_found`
