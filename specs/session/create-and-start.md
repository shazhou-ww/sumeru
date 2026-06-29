---
scenario: 创建新 session 并立即启动容器执行任务
feature: session-create-and-start
tags: [session, lifecycle, api, happy-path, validation]
---

# 创建并启动 Session

## Given

- Sumeru Host 已启动，监听端口 `7900`
- `host.yaml` 配置了 `workspaceRoot: /projects`，`maxRunning: 4`
- 已注册 prototype `coder`，对应 `compose.yaml` 存在
- 项目目录 `/projects/my-app` 存在于磁盘
- 当前 running session 数 < `maxRunning`

## When — 成功创建

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "my-app",
    "task": "Implement the login page",
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-20250514"
    },
    "env": {
      "CUSTOM_VAR": "value1"
    }
  }'
```

## Then — 201 Created

```json
{
  "type": "@sumeru/session",
  "value": {
    "id": "ses_01JXXXXXXXXXXXXXXXXXXXXXXX",
    "prototype": "coder",
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-20250514",
      "apiKey": "sk-ant-..."
    },
    "image": "sumeru-coder:latest",
    "project": "my-app",
    "task": "Implement the login page",
    "status": "running",
    "exit": null,
    "createdAt": "2026-06-29T10:00:00.000Z"
  }
}
```

**状态变化:**
- Session ID 使用 `ses_` 前缀 + ULID 生成
- Docker 容器已通过 `transport.up()` 启动
- Adapter 进程已 exec 进容器并完成 init 握手
- task 内容已作为首条 message 发送给 adapter

---

## When — prototype 不存在

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "nonexistent",
    "project": "my-app",
    "task": "Do something"
  }'
```

## Then — 404 Not Found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "prototype_not_found",
    "message": "Prototype not found"
  }
}
```

---

## When — project 路径无效或不存在

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "../escape-attempt",
    "task": "Do something"
  }'
```

## Then — 400 Bad Request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_project",
    "message": "Project path traversal not allowed"
  }
}
```

---

## When — 缺少必填字段

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": ""
  }'
```

## Then — 400 Bad Request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_request",
    "message": "Body must include non-empty string fields \"prototype\", \"project\", and \"task\""
  }
}
```

---

## When — prototype 无 compose.yaml

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "no-compose-proto",
    "project": "my-app",
    "task": "Do something"
  }'
```

## Then — 400 Bad Request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "prototype_no_compose",
    "message": "Prototype has no legacy compose.yaml for Docker workers"
  }
}
```

---

## When — model 字段无效

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "my-app",
    "task": "Do something",
    "model": { "provider": "invalid_provider", "name": "gpt-4" }
  }'
```

## Then — 400 Bad Request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_request",
    "message": "Body must include non-empty string fields \"prototype\", \"project\", and \"task\""
  }
}
```

---

## Notes

- `model` 字段可选；为 `null` 时使用 host 默认 model 配置
- `env` 字段可选；会与 host.yaml 中 `envFile` 指定的环境变量合并
- provider 支持 `"anthropic"` | `"openai"` | `"openrouter"` 或自定义 `{ name, endpoint, apiType }`
- 创建过程中若 transport.up 失败，会尝试 best-effort cleanup（down + rm）后抛出错误
