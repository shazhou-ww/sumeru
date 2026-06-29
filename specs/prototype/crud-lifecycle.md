---
scenario: Prototype 完整 CRUD 生命周期
feature: Prototype CRUD API
tags: [prototype, crud, lifecycle]
---

# Prototype 完整 CRUD 生命周期

Prototype 是 Worker Agent 的配置模板，支持完整的创建、读取、更新、删除操作。

## 背景

Prototype 以 YAML 文件持久化到磁盘，通过 REST API 管理。`name` 字段必须唯一且符合命名规范（`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`），`instructions` 为必填非空字符串。

---

## Scenario: 列出所有 Prototype

**Given** 系统中存在 prototype `code-review` 和 `test-runner`

**When** 发送请求：

```http
GET /prototypes
```

**Then** 响应状态码为 `200`，返回 prototype 列表：

```json
{
  "prototypes": [
    { "name": "code-review", "instructions": "...", "skills": ["git"], "defaults": null },
    { "name": "test-runner", "instructions": "...", "skills": [], "defaults": null }
  ]
}
```

---

## Scenario: 获取单个 Prototype 详情

**Given** 存在 prototype `code-review`

**When** 发送请求：

```http
GET /prototypes/code-review
```

**Then** 响应状态码为 `200`：

```json
{
  "prototype": {
    "name": "code-review",
    "instructions": "Review code changes for quality and correctness.",
    "skills": ["git"],
    "defaults": {
      "maxTurns": 30,
      "timeout": 600,
      "resources": { "cpu": 2, "memory": "4Gi" }
    }
  }
}
```

---

## Scenario: 获取不存在的 Prototype

**Given** 不存在 prototype `ghost`

**When** 发送请求：

```http
GET /prototypes/ghost
```

**Then** 响应状态码为 `404`：

```json
{
  "error": {
    "code": "prototype_not_found",
    "message": "Prototype ghost not found"
  }
}
```

---

## Scenario: 创建 Prototype（成功）

**Given** 不存在 prototype `my-agent`，且 skill `bash` 已存在

**When** 发送请求：

```http
POST /prototypes/my-agent
Content-Type: application/json

{
  "name": "my-agent",
  "instructions": "A general-purpose coding agent.",
  "skills": ["bash"],
  "defaults": {
    "maxTurns": 20,
    "timeout": 300,
    "resources": { "cpu": 1, "memory": "2Gi" }
  }
}
```

**Then** 响应状态码为 `201`：

```json
{
  "prototype": {
    "name": "my-agent",
    "instructions": "A general-purpose coding agent.",
    "skills": ["bash"],
    "defaults": { "maxTurns": 20, "timeout": 300, "resources": { "cpu": 1, "memory": "2Gi" } }
  }
}
```

---

## Scenario: 创建 Prototype（名称冲突 409）

**Given** 已存在 prototype `my-agent`

**When** 发送请求：

```http
POST /prototypes/my-agent
Content-Type: application/json

{
  "name": "my-agent",
  "instructions": "Another agent."
}
```

**Then** 响应状态码为 `409`：

```json
{
  "error": {
    "code": "prototype_exists",
    "message": "Prototype my-agent already exists"
  }
}
```

---

## Scenario: 创建 Prototype（body 中 name 与 URL 不匹配）

**Given** 不存在 prototype `agent-a`

**When** 发送请求：

```http
POST /prototypes/agent-a
Content-Type: application/json

{
  "name": "agent-b",
  "instructions": "Mismatch test."
}
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "invalid_body",
    "message": "Prototype request body field \"name\" (\"agent-b\") must match file name \"agent-a\""
  }
}
```

---

## Scenario: 创建 Prototype（缺少 instructions）

**Given** 不存在 prototype `no-inst`

**When** 发送请求：

```http
POST /prototypes/no-inst
Content-Type: application/json

{
  "name": "no-inst"
}
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "invalid_body",
    "message": "Prototype request body field \"instructions\" must be a string"
  }
}
```

---

## Scenario: 更新 Prototype（成功）

**Given** 存在 prototype `my-agent`

**When** 发送请求：

```http
PUT /prototypes/my-agent
Content-Type: application/json

{
  "name": "my-agent",
  "instructions": "Updated instructions for the agent.",
  "skills": [],
  "defaults": null
}
```

**Then** 响应状态码为 `200`：

```json
{
  "prototype": {
    "name": "my-agent",
    "instructions": "Updated instructions for the agent.",
    "skills": [],
    "defaults": null
  }
}
```

---

## Scenario: 更新不存在的 Prototype

**Given** 不存在 prototype `ghost`

**When** 发送请求：

```http
PUT /prototypes/ghost
Content-Type: application/json

{
  "name": "ghost",
  "instructions": "Does not exist."
}
```

**Then** 响应状态码为 `404`：

```json
{
  "error": {
    "code": "prototype_not_found",
    "message": "Prototype ghost not found"
  }
}
```

---

## Scenario: 删除 Prototype（成功）

**Given** 存在 prototype `my-agent`

**When** 发送请求：

```http
DELETE /prototypes/my-agent
```

**Then** 响应状态码为 `204`，无 body

---

## Scenario: 删除不存在的 Prototype

**Given** 不存在 prototype `ghost`

**When** 发送请求：

```http
DELETE /prototypes/ghost
```

**Then** 响应状态码为 `404`：

```json
{
  "error": {
    "code": "prototype_not_found",
    "message": "Prototype ghost not found"
  }
}
```

---

## 约束与校验规则

| 规则 | 说明 |
|------|------|
| `name` 格式 | 必须匹配 `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` |
| `name` 唯一性 | 同名 prototype 创建返回 `409` |
| `name` 一致性 | body 中 `name` 必须与 URL path 中的 `:name` 一致 |
| `instructions` 必填 | 必须为字符串类型 |
| `skills` 可选 | 数组，元素必须为字符串；引用的 skill 必须存在 |
| `defaults` 可选 | 为 `null` 或包含 `maxTurns`、`timeout`、`resources` 的对象 |
| Content-Type | 支持 `application/json` 和 YAML（默认） |

## API 路由总览

| 方法 | 路径 | 成功状态码 | 说明 |
|------|------|:---:|------|
| GET | `/prototypes` | 200 | 列出全部 |
| GET | `/prototypes/:name` | 200 | 获取详情 |
| POST | `/prototypes/:name` | 201 | 创建 |
| PUT | `/prototypes/:name` | 200 | 更新 |
| DELETE | `/prototypes/:name` | 204 | 删除 |

源码参考：`packages/host/src/handlers/prototypes.ts`、`packages/host/src/data-store.ts`
