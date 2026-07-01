---
scenario: Model 完整 CRUD 生命周期
feature: Model CRUD API
tags: [model, crud, lifecycle, sqlite]
---

# Model 完整 CRUD 生命周期

Model 是 LLM 模型注册条目（SQLite 实体，Phase 1 新增），引用 Provider。

## Model 字段

```json
{
  "id": "claude-sonnet",
  "provider": "anthropic",
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
| id | string | ✅ (URL) | 唯一标识，来自 URL `:id` |
| provider | string | ✅ | 引用 Provider.name（必须存在） |
| model | string | ✅ | 实际模型名称（发送给 API 的） |
| contextWindow | number \| null | ❌ | 上下文窗口大小 |
| toolUse | boolean | ❌ | 是否支持 tool use（默认 true） |
| streaming | boolean | ❌ | 是否支持 streaming（默认 true） |
| metadata | object \| null | ❌ | 自定义元数据 |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /models | 列出所有 |
| GET | /models/:id | 单个详情 |
| POST | /models/:id | 创建（201 / 400 / 409） |
| PUT | /models/:id | 更新（200 / 400 / 404） |
| DELETE | /models/:id | 删除（204 / 404） |

### 引用校验

创建/更新 Model 时 `provider` 必须引用已存在的 Provider，否则返回 `400 provider_not_found`。

### 响应信封

```json
{ "type": "@sumeru/model", "value": { ... } }
{ "type": "@sumeru/model-list", "value": [ ... ] }
```
