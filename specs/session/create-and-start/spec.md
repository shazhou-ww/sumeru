---
scenario: 创建并启动 Session
feature: Session Create & Start
tags: [session, create, model, e2e]
---

# Session Create & Start

通过 `POST /sessions` 创建 session，host 执行以下流程：

1. 解析 `prototype` → 从 Prototype YAML 读取 persona / model / image / defaults
2. 解析 `model` → 三态 model override 解析（见下文）
3. 解析 `project` → 验证路径在 workspaceRoot 内
4. 启动容器 → Docker Compose up
5. 初始化 adapter → 发送 init config（含 persona instructions / model / defaults）
6. 投递 task → 作为第一条 user message 发送

## Model 解析三态

`model` 字段支持三种模式：

| 模式 | 请求体 | 行为 |
|------|--------|------|
| **省略/null** | `"model": null` 或不传 | 使用 prototype 定义的 `model` (Model.id)，从 SQLite 查 Model → Provider → 组装 ModelConfig |
| **Model ID (string)** | `"model": "gpt-4o"` | 覆盖 prototype 默认值，从 SQLite 查 Model.id = "gpt-4o" |
| **Ad-hoc (object)** | `"model": {"provider": {...}, "name": "..."}` | 完全跳过 SQLite，直接使用 inline provider 配置 |

### Model ID 解析链

```
model (string) → sqliteStore.getModel(id) → Model.provider → sqliteStore.getProvider(name)
  → Provider.apiType / Provider.baseUrl / Provider.apiKey
  → 组装 ModelConfig { provider: CustomProvider, name: Model.model, apiKey }
```

若 Model 或 Provider 不存在，抛 `model_not_found` / `provider_not_found` 错误。

## 参数行为

- `task` parameter is optional. When null, session starts in idle state (no message sent).
- `project` parameter is optional. When null, no volume is mounted.

## 持久化

- Session metadata is persisted to SQLite on creation (id, prototype, project, task, model, status, containerName, createdAt)
- On host restart, persisted sessions are restored as idle. Resume reattaches to existing stopped containers.
- session delete: removes from SQLite + removes JSONL log + docker rm container

## 请求格式

```http
POST /sessions
Content-Type: application/json

{
  "prototype": "hermes",
  "project": "my-project",
  "task": "Say hello",
  "model": null,
  "env": { "EXTRA_VAR": "value" }
}
```

## 前置条件

Session 创建要求以下实体在 SQLite 中预先存在：

1. **Provider** — `POST /providers/:name` 创建
2. **Model** — `POST /models/:id` 创建，引用已有 Provider
3. **Persona** — `POST /personas/:name` 创建（纯 system prompt 文本）
4. **Prototype** — `POST /prototypes/:name` 创建，引用已有 Persona + Model

## 成功响应

```json
{
  "type": "@sumeru/session",
  "value": {
    "id": "ses-xxx-xxx",
    "prototype": "hermes",
    "model": {
      "provider": { "name": "my-provider", "endpoint": "https://api.anthropic.com", "apiType": "anthropic" },
      "name": "claude-sonnet-4-20250514",
      "apiKey": null
    },
    "image": "sumeru-worker:latest",
    "project": "my-project",
    "task": "Say hello",
    "status": "running",
    "exit": null,
    "createdAt": "2026-07-01T12:00:00.000Z"
  }
}
```

注意 `model` 字段返回的是解析后的完整 `ModelConfig`（始终是 `{ provider, name, apiKey }` 结构），不是请求时的 string/null。

---

## 错误路径

| 错误 | HTTP | error code |
|------|------|------------|
| Prototype 不存在 | 404 | `prototype_not_found` |
| Prototype 无 compose.yaml | 400 | `prototype_no_compose` |
| Project 路径越界 | 400 | `invalid_project` |
| Model ID 在 SQLite 中不存在 | 500 | `internal_error` (msg: `model_not_found:<id>`) |
| Provider 在 SQLite 中不存在 | 500 | `internal_error` (msg: `provider_not_found:<name>`) |
| JSON 解析失败 | 400 | `invalid_json` |
| 缺少必填字段 | 400 | `invalid_request` |
