# Session Commands

> atest: [`session-commands.test.yaml`](./session-commands.test.yaml)

## API

| Method | Path | 说明 |
|--------|------|------|
| POST | /sessions/:id/commands | Dispatch command to running session |

### Command Types

| type | 说明 | Response |
|------|------|----------|
| model | Switch session model | 200 sync |
| reset | Clear context, optionally re-init persona | 202 async |
| install-skill | Write skill files into container | 200 sync |
| snapshot | Docker commit + register new prototype | 200 sync |
| chat | Submit message to session | 202 async |
| exec | Execute shell command in container | 200 sync |

### 响应信封

```json
{ "type": "@sumeru/command-result", "value": { "command": "model", "result": { ... } } }
```

---

## Given
- Host is running and healthy
- Session "sess-001" exists and is idle
- Model "anthropic:claude-3" exists in SQLite

## When — switch model
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"anthropic","model":"claude-3"}'
```

## Then — 200 model switched
```json
{ "type": "@sumeru/command-result", "value": { "command": "model", "result": { "provider": "anthropic", "model": "claude-3" } } }
```

---

## When — switch to nonexistent model
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"fake","model":"nonexistent"}'
```

## Then — 404 model_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "model_not_found", "message": "Model not found" } }
```

---

## When — switch model with invalid format
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"","model":""}'
```

## Then — 400 model_invalid_format
```json
{ "type": "@sumeru/error", "value": { "code": "model_invalid_format", "message": "Invalid model ID format. Expected format: provider:name" } }
```

---

## When — reset session
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"reset","persona":null}'
```

## Then — 202 accepted (async)
```json
{ "type": "@sumeru/command-result", "value": { "command": "reset", "status": "accepted" } }
```

---

## When — reset session with new persona
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"reset","persona":"analyst"}'
```

## Then — 202 accepted
```json
{ "type": "@sumeru/command-result", "value": { "command": "reset", "status": "accepted" } }
```

---

## When — install skill
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"install-skill","name":"web-scraper","content":null,"files":[{"path":"scraper.py","content":"import requests..."}]}'
```

## Then — 200 skill installed
```json
{ "type": "@sumeru/command-result", "value": { "command": "install-skill", "result": { "name": "web-scraper", "filesWritten": 1 } } }
```

---

## When — snapshot session
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"snapshot","name":"my-snapshot"}'
```

## Then — 200 snapshot created
```json
{ "type": "@sumeru/command-result", "value": { "command": "snapshot", "result": { "prototype": "my-snapshot" } } }
```

---

## When — chat message
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","content":"Hello, world!","messageId":null,"env":null,"model":null}'
```

## Then — 202 accepted (async)
```json
{ "type": "@sumeru/command-result", "value": { "command": "chat", "status": "accepted" } }
```

---

## When — chat while session is busy
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","content":"Another message","messageId":null,"env":null,"model":null}'
```

## Then — 409 session_busy
```json
{ "type": "@sumeru/error", "value": { "code": "session_busy", "message": "Session is already processing a request" } }
```

---

## When — exec command
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"exec","command":"ls -la /workspace"}'
```

## Then — 200 exec result
```json
{ "type": "@sumeru/command-result", "value": { "command": "exec", "result": { "output": "total 8\ndrwxr-xr-x ..." } } }
```

---

## When — command to nonexistent session
```bash
curl -s -X POST http://localhost:3000/sessions/nonexistent/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"anthropic","model":"claude-3"}'
```

## Then — 404 session_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "session_not_found", "message": "Session not found" } }
```

---

## When — invalid JSON body
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d 'not json'
```

## Then — 400 invalid_json
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_json", "message": "Request body is not valid JSON" } }
```

---

## When — invalid command type
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"invalid"}'
```

## Then — 400 invalid_request
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "Invalid command type" } }
```

---

## When — adapter not ready
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","content":"hello","messageId":null,"env":null,"model":null}'
```

## Then — 503 adapter_unavailable
```json
{ "type": "@sumeru/error", "value": { "code": "adapter_unavailable", "message": "Adapter is not ready" } }
```

---

## Notes
- Commands are discriminated by the "type" field in the request body
- "model" and "exec" are synchronous (200), "reset" and "chat" are asynchronous (202)
- "install-skill" writes files directly into the running container
- "snapshot" performs docker commit and registers the result as a new prototype
- session_busy (409) only applies to "chat" commands when session is already processing
- CLI: `sumeru session model <id> <model-id>`, `sumeru reset <id>`, `sumeru snapshot <id>`

---

# 标准 HTTP 错误响应

> atest: [`error-paths.test.yaml`](./error-paths.test.yaml)

所有 Sumeru Host API 端点共享统一的错误响应结构。本规范定义各 HTTP 错误码的触发条件、返回格式和具体场景。

## 错误响应体结构

所有错误响应遵循 envelope 格式：

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "<error_code>",
    "message": "<人类可读描述>"
  }
}
```

- `type`: 固定为 `"@sumeru/error"`
- `value.error`: 机器可读错误码（snake_case）
- `value.message`: 描述性错误信息

---

## 400 Bad Request — 请求验证失败

客户端请求格式错误或参数不合法时返回 400。

---

### Scenario: 请求体不是合法 JSON

#### Given

- Sumeru Host 已启动，监听端口 `7900`

#### When — 发送非法 JSON 体

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{invalid json'
```

#### Then — 400 invalid_json

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_json",
    "message": "Request body must be valid JSON"
  }
}
```

---

### Scenario: 创建 session 缺少必填字段

#### Given

- Sumeru Host 已启动

#### When — 缺少 prototype 字段

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{"project": "my-app", "task": "do something"}'
```

#### Then — 400 invalid_request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_request",
    "message": "Body must include a non-empty string field \"prototype\""
  }
}
```

---

### Scenario: model 格式不合法

#### Given

- Sumeru Host 已启动

#### When — model.provider 值不在允许范围

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "my-app",
    "task": "implement login",
    "model": { "provider": "invalid_provider", "name": "gpt-4" }
  }'
```

#### Then — 400 invalid_request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_request",
    "message": "Body must include a non-empty string field \"prototype\""
  }
}
```

**说明:** `parseModelBody()` 返回 `"invalid"` 时，整个 `parseCreateBody()` 返回 null，触发通用 invalid_request 错误。合法的 provider 值为 `"anthropic"` | `"openai"` | `"openrouter"` 或自定义对象 `{ name, endpoint, apiType }`。

---

### Scenario: project 路径解析失败

#### Given

- Sumeru Host 已启动
- prototype `"coder"` 存在且有 compose.yaml

#### When — project 路径超出 workspaceRoot 范围

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "../../etc/passwd",
    "task": "hack"
  }'
```

#### Then — 400 invalid_project

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_project",
    "message": "path escapes workspace root"
  }
}
```

**说明:** `session-manager.ts` 中 `resolveProjectPath()` 验证路径安全性，失败时抛出 `invalid_project:<message>`，handler 解析并返回 400。

---

### Scenario: prototype 缺少 compose.yaml

#### Given

- Sumeru Host 已启动
- prototype `"bare"` 存在但无 compose.yaml 文件

#### When — 用无 compose 的 prototype 创建 session

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "bare",
    "project": "my-app",
    "task": "run tests"
  }'
```

#### Then — 400 prototype_no_compose

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

### Scenario: prototype 引用不存在的 skill

#### Given

- Sumeru Host 已启动
- skill `"nonexistent-skill"` 不存在于 skills 目录

#### When — 创建/更新 prototype 引用缺失的 skill

```bash
curl -X PUT http://localhost:7900/prototypes/my-proto \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-proto",
    "skills": ["nonexistent-skill"],
    "image": "sumeru-coder:latest"
  }'
```

#### Then — 400 skills_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skills_not_found",
    "message": "Missing skills: nonexistent-skill"
  }
}
```

---

### Scenario: skill 请求体格式错误

#### Given

- Sumeru Host 已启动

#### When — PUT skill 时 JSON body 缺少 content 字段

```bash
curl -X PUT http://localhost:7900/skills/my-skill \
  -H "Content-Type: application/json" \
  -d '{"name": "my-skill"}'
```

#### Then — 400 invalid_body

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_body",
    "message": "Skill body must be plain text or JSON { content: string }"
  }
}
```

---

### Scenario: prototype 请求体验证失败

#### Given

- Sumeru Host 已启动

#### When — prototype body 不合法

```bash
curl -X PUT http://localhost:7900/prototypes/my-proto \
  -H "Content-Type: application/json" \
  -d '{"name": "wrong-name", "skills": []}'
```

#### Then — 400 invalid_body

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_body",
    "message": "name must match URL parameter"
  }
}
```

**说明:** `readPrototypeBody()` 调用 `validatePrototype()` 验证 body，name 必须与 URL 参数一致。

---

## 404 Not Found — 资源不存在

请求的资源 ID/名称在系统中找不到时返回 404。

---

### Scenario: session 不存在

#### Given

- Sumeru Host 已启动
- 不存在 ID 为 `ses_NONEXISTENT` 的 session

#### When — 请求不存在的 session 详情

```bash
curl http://localhost:7900/sessions/ses_NONEXISTENT
```

#### Then — 404 session_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_not_found",
    "message": "Session ses_NONEXISTENT not found"
  }
}
```

---

### Scenario: 停止不存在的 session

#### Given

- 不存在 ID 为 `ses_GHOST` 的 session

#### When — 对不存在的 session 执行 stop

```bash
curl -X POST http://localhost:7900/sessions/ses_GHOST/stop
```

#### Then — 404 session_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_not_found",
    "message": "Session not found"
  }
}
```

**说明:** session detail handler 直接检查返回带 ID 的 message；stop/delete 通过 `writeSessionError` 返回通用 message。

---

### Scenario: prototype 不存在

#### Given

- Sumeru Host 已启动
- 不存在名为 `"ghost-proto"` 的 prototype

#### When — 请求不存在的 prototype

```bash
curl http://localhost:7900/prototypes/ghost-proto
```

#### Then — 404 prototype_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "prototype_not_found",
    "message": "Prototype ghost-proto not found"
  }
}
```

---

### Scenario: 创建 session 引用不存在的 prototype

#### Given

- Sumeru Host 已启动
- 不存在名为 `"deleted-proto"` 的 prototype

#### When — 用不存在的 prototype 创建 session

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "deleted-proto",
    "project": "my-app",
    "task": "build feature"
  }'
```

#### Then — 404 prototype_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "prototype_not_found",
    "message": "Prototype not found"
  }
}
```

**说明:** `session-manager.ts` 的 `createSession()` 在 `hostConfig.prototypes.get()` 返回 undefined 时抛出 `prototype_not_found`，经 `writeSessionError` 映射为 404。

---

### Scenario: skill 不存在

#### Given

- Sumeru Host 已启动
- 不存在名为 `"ghost-skill"` 的 skill 文件

#### When — 请求不存在的 skill

```bash
curl http://localhost:7900/skills/ghost-skill
```

#### Then — 404 skill_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skill_not_found",
    "message": "Skill ghost-skill not found"
  }
}
```

---

### Scenario: image 不存在

#### Given

- Sumeru Host 已启动
- 不存在名为 `"ghost-image"` 的 image 配置

#### When — 请求不存在的 image

```bash
curl http://localhost:7900/images/ghost-image
```

#### Then — 404 image_not_found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "image_not_found",
    "message": "Image ghost-image not found"
  }
}
```

---

## 409 Conflict — 状态冲突

操作与资源当前状态不兼容时返回 409。

---

### Scenario: 停止已 idle 的 session

#### Given

- Sumeru Host 已启动
- session `ses_01J9ABCDEF1234567890ABCDE` 的 `status` 为 `"idle"`

#### When — 尝试停止已 idle 的 session

```bash
curl -X POST http://localhost:7900/sessions/ses_01J9ABCDEF1234567890ABCDE/stop
```

#### Then — 409 session_already_idle

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_already_idle",
    "message": "Session is already idle"
  }
}
```

**说明:** `session-manager.ts` 的 `stopSession()` 在 `record.status === "idle"` 时抛出 `session_already_idle`，经 `writeSessionError` 映射为 409。

---

### Scenario: 删除被 prototype 引用的 skill

#### Given

- Sumeru Host 已启动
- skill `"code-review"` 被 prototype `"reviewer"` 和 `"senior-dev"` 引用

#### When — 尝试删除被引用的 skill

```bash
curl -X DELETE http://localhost:7900/skills/code-review
```

#### Then — 409 skill_referenced

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skill_referenced",
    "message": "Skill code-review is referenced by prototypes: reviewer, senior-dev"
  }
}
```

**说明:** `skills.ts` handler 调用 `findPrototypeReferencesToSkill()` 检查引用关系，有引用时返回 409 阻止删除。

---

### Scenario: 创建已存在的 prototype

#### Given

- Sumeru Host 已启动
- prototype `"coder"` 已存在

#### When — 尝试创建同名 prototype

```bash
curl -X PUT http://localhost:7900/prototypes/coder \
  -H "Content-Type: application/json" \
  -d '{
    "name": "coder",
    "skills": ["coding"],
    "image": "sumeru-coder:latest"
  }'
```

**注意:** 创建操作使用特定的 create 路由（非 update）。

#### Then — 409 prototype_exists

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "prototype_exists",
    "message": "Prototype coder already exists"
  }
}
```

**说明:** `prototypes.ts` 的 `create()` handler 先调用 `prototypeFileExists()` 检查，存在则返回 409。

---

## 500 Internal Server Error — 内部错误

服务端未预期的异常。所有未被具体 error code 匹配的 `catch` 块都回退到 500。

---

### Scenario: adapter 启动超时

#### Given

- Sumeru Host 已启动
- prototype `"coder"` 存在且配置正确
- Docker daemon 响应缓慢或容器启动失败

#### When — 创建 session 但 adapter 不能在超时内就绪

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "my-app",
    "task": "build feature"
  }'
```

#### Then — 500 internal_error

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "internal_error",
    "message": "adapter_ready_timeout"
  }
}
```

**说明:** `session-manager.ts` 的 `ensureAdapterReady()` 超时后抛出 `adapter_ready_timeout`，由 `writeSessionError` 的 `default` 分支映射为 500。

---

### Scenario: adapter I/O 错误

#### Given

- Sumeru Host 已启动
- 一个 session 正在运行
- adapter 进程意外退出或 stdout 关闭

#### When — adapter stdout 关闭后系统检测到 I/O 中断

#### Then — session 进入 idle 状态，错误帧被记录

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "adapter_io_error",
    "message": "adapter stdout closed"
  }
}
```

**说明:** 这不是 HTTP 响应，而是通过 SSE 推送的错误帧。`session-manager.ts` 构造 `errorFrame` 并调用 `handleAdapterFrame` + `markIdle`。

---

### Scenario: prototype 写入磁盘失败

#### Given

- Sumeru Host 已启动
- prototypes 目录权限异常

#### When — 尝试创建 prototype 但写入失败

```bash
curl -X PUT http://localhost:7900/prototypes/new-proto \
  -H "Content-Type: application/json" \
  -d '{
    "name": "new-proto",
    "skills": [],
    "image": "sumeru-coder:latest"
  }'
```

#### Then — 500 internal_error

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "internal_error",
    "message": "EACCES: permission denied, open '/path/to/prototypes/new-proto.yaml'"
  }
}
```

**说明:** `writePrototypeError()` 中未匹配 "must match"/"must be" 模式的错误回退为 500 internal_error。

---

## 错误码汇总表

| HTTP Status | Error Code | 触发条件 | Handler 来源 |
|-------------|-----------|---------|-------------|
| 400 | `invalid_json` | 请求体非合法 JSON | sessions.ts |
| 400 | `invalid_request` | 缺少必填字段或 model 格式错误 | sessions.ts |
| 400 | `invalid_project` | project 路径不安全或不存在 | sessions.ts → session-manager.ts |
| 400 | `prototype_no_compose` | prototype 无 compose.yaml | sessions.ts → session-manager.ts |
| 400 | `skills_not_found` | prototype 引用的 skill 不存在 | prototypes.ts |
| 400 | `invalid_body` | prototype/skill body 解析失败 | prototypes.ts, skills.ts |
| 400 | `invalid_prototype` | prototype 字段校验失败 | prototypes.ts |
| 400 | `invalid_name` | skill name 格式不合法 | skills.ts |
| 404 | `session_not_found` | session ID 不存在 | sessions.ts |
| 404 | `prototype_not_found` | prototype name 不存在 | prototypes.ts, sessions.ts |
| 404 | `skill_not_found` | skill name 不存在 | skills.ts |
| 404 | `image_not_found` | image name 不存在 | images.ts |
| 409 | `session_already_idle` | 停止已 idle 的 session | sessions.ts → session-manager.ts |
| 409 | `skill_referenced` | 删除被 prototype 引用的 skill | skills.ts |
| 409 | `prototype_exists` | 创建已存在的 prototype | prototypes.ts |
| 500 | `internal_error` | 未预期的服务端异常 | 所有 handler 的 fallback |

---

## Notes

- 所有错误响应的 `Content-Type` 为 `application/json`
- envelope 格式确保客户端可以统一解析 `type` 字段判断是否为错误
- `writeSessionError()` 是 session 相关操作的统一错误映射函数，按 error message 字符串 switch 到对应 HTTP 状态码
- `writePrototypeError()` 和 `writeSkillError()` 分别处理 prototype/skill 操作的错误映射
- `adapter_io_error` 通过 SSE 事件流推送而非 HTTP 响应返回

---

# Session Resume After Host Restart

> atest: [`resume-after-restart.test.yaml`](./resume-after-restart.test.yaml)

Host 重启后，sarsapa session 通过 JSONL 持久化恢复对话上下文。

## 机制

### Adapter 协议扩展

`AdapterImpl` 新增可选 `resume?(): boolean | Promise<boolean>`：
- 返回 `true` → adapter 已从持久化数据恢复，发 `ready`，跳过 `init`
- 返回 `false` / 未实现 → 等待 Host 发 `init`

### Host 行为

- 新 session（`initVersion === null`）：发 `init`
- 已初始化 session（`initVersion !== null`）：不发 `init`，等 adapter 自行 resume

### Sarsapa JSONL 持久化

路径：容器内 `/workspace/.sarsapa/session.jsonl`

```jsonl
{"type":"init","system":"...","model":{...}}
{"role":"user","content":"hello","toolCalls":null,"toolCallId":null}
{"role":"assistant","content":"Hi!","toolCalls":null,"toolCallId":null}
```

- `init` 时写入第一行
- 每个 turn（user/assistant/tool）追加一行
- 重启时读取 → 重建 Conversation + initConfig

---

# 列出 Session Turns 并支持分页

> atest: [`turns-pagination.test.yaml`](./turns-pagination.test.yaml)

Session 的 Turn 列表通过 `GET /sessions/:id/turns` 获取，支持基于游标的 `?after=<id>` 分页机制。

## 背景

Turn 是 OCAS 执行过程中持久化的对话记录，每个 Turn 拥有递增整数 `id`。客户端可通过轮询 `?after=<lastSeenId>` 增量获取新 Turn。

---

## Scenario: 获取 Session 的全部 Turns

**Given** 存在一个 Session（id = `ses-abc`），其中包含 3 条 Turn 记录

**When** 发送请求：

```http
GET /sessions/ses-abc/turns
```

**Then** 响应状态码为 `200`，body 为 Turn 数组信封：

```json
{
  "turns": [
    { "id": 0, "role": "assistant", "content": "...", "toolCalls": [], "tokenUsage": {"input":100,"output":50,"cached":0}, "durationMs": 320, "timestamp": "..." },
    { "id": 1, "role": "tool", "callId": "call_1", "name": "bash", "result": "...", "durationMs": 150, "timestamp": "..." },
    { "id": 2, "role": "assistant", "content": "...", "toolCalls": [], "tokenUsage": {"input":200,"output":80,"cached":50}, "durationMs": 410, "timestamp": "..." }
  ]
}
```

---

## Scenario: 使用 `?after=<id>` 增量分页

**Given** 存在一个 Session（id = `ses-abc`），包含 id 为 0–4 的 Turn

**When** 发送请求：

```http
GET /sessions/ses-abc/turns?after=2
```

**Then** 响应状态码为 `200`，仅返回 id > 2 的 Turn：

```json
{
  "turns": [
    { "id": 3, "role": "tool", "callId": "call_2", "name": "read_file", "result": "...", "durationMs": 90, "timestamp": "..." },
    { "id": 4, "role": "assistant", "content": "...", "toolCalls": [], "tokenUsage": {"input":300,"output":120,"cached":100}, "durationMs": 500, "timestamp": "..." }
  ]
}
```

---

## Scenario: `?after` 参数非法（非整数）

**Given** 存在一个 Session（id = `ses-abc`）

**When** 发送请求：

```http
GET /sessions/ses-abc/turns?after=abc
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Query parameter 'after' must be a non-negative integer (got 'abc')"
  }
}
```

---

## Scenario: `?after` 参数为超大数（非安全整数）

**Given** 存在一个 Session（id = `ses-abc`）

**When** 发送请求：

```http
GET /sessions/ses-abc/turns?after=99999999999999999999
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Query parameter 'after' must be a non-negative integer (got '99999999999999999999')"
  }
}
```

---

## Scenario: Session 不存在

**Given** 不存在 id 为 `ses-ghost` 的 Session

**When** 发送请求：

```http
GET /sessions/ses-ghost/turns
```

**Then** 响应状态码为 `404`：

```json
{
  "error": {
    "code": "session_not_found",
    "message": "Session not found"
  }
}
```

---

## User Turns

GET /sessions/:id/turns now returns user turns (role=user) in addition to assistant and tool turns.

### UserTurn type

```typescript
type UserTurn = {
  id: number;
  role: "user";
  content: string;
  timestamp: string; // ISO 8601
}
```

### Query parameter: `system=true`

Query parameter `system=true` includes system prompt turns (rendered as role=user with [system] prefix).

```http
GET /sessions/ses-abc/turns?system=true
```

When `system=true`, the system prompt is included as the first turn with `role: "user"` and content prefixed with `[system]`.

---

## 实现细节

| 行为 | 说明 |
|------|------|
| 路由 | `GET /sessions/:id/turns` |
| 分页参数 | `?after=<id>`，返回 id 严格大于该值的 Turn |
| `after` 校验 | 必须为非负整数（`/^\d+$/`），且为安全整数（`Number.isSafeInteger`） |
| Session 不存在 | 返回 `404` + `session_not_found` |
| 空 `after` | 等同于不带参数，返回全部 Turn |
| Turn 类型 | `AssistantTurn \| ToolTurn \| UserTurn`，由 `role` 区分 |
| `system` 参数 | `?system=true` 时在响应开头插入 system prompt turn |

源码参考：`packages/host/src/handlers/turns.ts`