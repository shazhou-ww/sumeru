# Provider 完整 CRUD 生命周期

> atest: [`provider-crud.test.yaml`](../atest/provider-crud.test.yaml)

Provider 是 LLM 接入点配置（SQLite 实体）。管理 API endpoint、协议类型和密钥。

## Provider 字段

```json
{
  "name": "anthropic",
  "apiType": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "apiKey": "sk-xxx",
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | 唯一标识，来自 URL `:name` |
| apiType | "anthropic" \| "openai" | ✅ | API 协议类型 |
| baseUrl | string \| null | ❌ | 自定义 endpoint，null 用默认 |
| apiKey | string \| null | ❌ | API key，null 从环境取 |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /providers | 列出所有 |
| GET | /providers/:name | 单个详情 |
| PUT | /providers/:name | upsert（201 新建 / 200 替换） |
| DELETE | /providers/:name | 删除（204 / 404 / 409） |

PUT 使用 merge 语义 — 省略的字段保留现有值。

### 删除保护

删除 Provider 时若有 Model 引用它，返回 `409 provider_in_use`。

### 响应信封

```json
{ "type": "@sumeru/provider", "value": { ... } }
{ "type": "@sumeru/provider-list", "value": [ ... ] }
```

---

## Scenario: 列出所有 Provider

**When** `GET /providers`

**Then** 200，返回 `@sumeru/provider-list`

**Then** 每项包含 name、apiType、baseUrl（apiKey 脱敏）

---

## Scenario: 创建 Provider

**Given** Provider "openai" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai \
  -H "Content-Type: application/json" \
  -d '{"apiType":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"sk-xxx"}'
```

**Then** 201 created
```json
{ "type": "@sumeru/provider", "value": { "name": "openai", "apiType": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-xxx" } }
```

---

## Scenario: 更新 Provider (merge)

**Given** Provider "openai" 已存在，baseUrl = "https://api.openai.com/v1"

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-yyy"}'
```

**Then** 200 updated（baseUrl 保留原值，apiKey 被替换）
```json
{ "type": "@sumeru/provider", "value": { "name": "openai", "apiType": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-yyy" } }
```

---

## Scenario: 删除 Provider

**When** `DELETE /providers/openai`

**Then** 204 No Content

**When** `GET /providers/openai`

**Then** 404 `provider_not_found`

---

## Scenario: 删除被引用的 Provider

**Given** Provider "openai" 被 Model "openai:gpt-4" 引用

**When** `DELETE /providers/openai`

**Then** 409 `provider_in_use`
```json
{ "type": "@sumeru/error", "value": { "code": "provider_in_use", "message": "Provider openai is referenced by 1 model(s)" } }
```

---

## Scenario: 获取不存在的 Provider

**When** `GET /providers/nonexistent`

**Then** 404 `provider_not_found`
