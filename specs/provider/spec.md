---
scenario: Provider 完整 CRUD 生命周期
feature: Provider CRUD API
tags: [provider, crud, lifecycle, sqlite]
---

# Provider 完整 CRUD 生命周期

> atest: [`crud-lifecycle.test.yaml`](./crud-lifecycle.test.yaml)

Provider 是 LLM 接入点配置（SQLite 实体，Phase 1 新增）。

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
