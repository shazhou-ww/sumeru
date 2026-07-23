# Model 完整 CRUD 生命周期

> atest: [`model-crud.test.yaml`](../atest/model-crud.test.yaml)

Model 是 LLM 模型注册条目（SQLite 实体），嵌套在 Provider 下。完整标识为 `provider:name`（如 `copilot:claude-sonnet-4`）。

## Model 字段

```json
{
  "name": "claude-sonnet-4",
  "provider": "copilot",
  "model": "claude-sonnet-4-20250514",
  "contextWindow": 200000,
  "toolUse": true,
  "streaming": true,
  "metadata": null,
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | Provider 内的模型名，来自 URL `:modelName` |
| provider | string | ✅ | 引用 Provider.name（来自 URL `:name`） |
| model | string | ✅ | 实际模型名称（发送给 API 的） |
| contextWindow | number \| null | ❌ | 上下文窗口大小 |
| toolUse | boolean | ❌ | 是否支持 tool use（默认 true） |
| streaming | boolean | ❌ | 是否支持 streaming（默认 true） |
| metadata | object \| null | ❌ | 自定义元数据 |

### 复合标识 `provider:name`

- Prototype 的 `model` 字段、Session model override 字符串均使用 `provider:name` 格式
- SQLite 内部 `models.id` 列存储 `provider:name` 值
- CLI 命令参数使用同一格式，如 `sumeru model get copilot:claude-sonnet-4`

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /models | 列出所有 Provider 下的模型（便捷路由） |
| GET | /providers/:name/models | 列出指定 Provider 下的模型 |
| GET | /providers/:name/models/:modelName | 单个详情 |
| PUT | /providers/:name/models/:modelName | upsert（201 新建 / 200 更新） |
| DELETE | /providers/:name/models/:modelName | 删除（204 / 404） |

PUT 使用 merge 语义 — 省略的字段保留现有值。新建时 `model`（API 模型字符串）必填。

### 引用校验

upsert 时 URL 中的 `:name`（Provider）必须存在，否则返回 `404 provider_not_found`。

### 响应信封

```json
{ "type": "@sumeru/model", "value": { ... } }
{ "type": "@sumeru/model-list", "value": [ ... ] }
```

---

## Scenario: 列出所有 Model

**When** `GET /models`

**Then** 200，返回 `@sumeru/model-list`

**Then** 每项包含 name、provider、model、contextWindow

---

## Scenario: 创建 Model

**Given** Provider "openai" 已存在

**Given** Model "openai:gpt-4" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai/models/gpt-4 \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4-turbo-preview","contextWindow":128000}'
```

**Then** 201 created
```json
{ "type": "@sumeru/model", "value": { "name": "gpt-4", "provider": "openai", "model": "gpt-4-turbo-preview", "contextWindow": 128000, "toolUse": true, "streaming": true } }
```

---

## Scenario: 更新 Model (merge)

**Given** Model "openai:gpt-4" 已存在，contextWindow = 128000

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai/models/gpt-4 \
  -H "Content-Type: application/json" \
  -d '{"toolUse":false}'
```

**Then** 200 updated（contextWindow 保留原值，toolUse 被替换）
```json
{ "type": "@sumeru/model", "value": { "name": "gpt-4", "provider": "openai", "model": "gpt-4-turbo-preview", "contextWindow": 128000, "toolUse": false, "streaming": true } }
```

---

## Scenario: 删除 Model

**When** `DELETE /providers/openai/models/gpt-4`

**Then** 204 No Content

**When** `GET /providers/openai/models/gpt-4`

**Then** 404 `model_not_found`

---

## Scenario: 获取不存在的 Model

**When** `GET /providers/openai/models/nonexistent`

**Then** 404 `model_not_found`

---

## Scenario: 在 Provider 不存在时创建 Model

**Given** Provider "nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/nonexistent/models/gpt-4 \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4"}'
```

**Then** 404 `provider_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "provider_not_found", "message": "Provider not found" } }
```