---
scenario: Model 完整 CRUD 生命周期
feature: Model CRUD API
tags: [model, crud, lifecycle, sqlite]
---

# Model 完整 CRUD 生命周期

> atest: [`crud-lifecycle.test.yaml`](./crud-lifecycle.test.yaml)

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
