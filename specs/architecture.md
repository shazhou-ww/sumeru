# Sumeru 架构设计

> 芥子纳须弥 — 一粒芥子里装一座须弥山

## 一句话

Sumeru 是 **agent house** — 一个 HTTP 服务，为同一运行环境内的多个 agent 提供统一的收发室，所有交互通过 ocas 全量记录。

## 核心概念

### Sumeru Instance（房子）

一个 Sumeru 进程 = 一个运行环境的 agent 管理层。

每个小队节点跑一个 Sumeru 实例，对外暴露一个 endpoint URL。不管底层是本机、Docker 容器、还是远程服务器 — 对外都是同一个 HTTP 接口。

```
sumeru@neko  →  https://oc-neko.shazhou.work/sumeru
sumeru@kuma  →  https://oc-kuma.shazhou.work/sumeru
sumeru@raku  →  https://oc-raku.shazhou.work/sumeru
```

### Gateway（住户）

一个 Sumeru 实例内可以有多个 gateway。每个 gateway 对应一个 agent，负责与该 agent 通信。

```yaml
# sumeru.yaml — 实例配置
name: sumeru@neko

gateways:
  hermes:
    adapter: hermes
    capabilities:
      resume: true
      streaming: true

  claude-code:
    adapter: claude-code
    capabilities:
      resume: true
      streaming: false
```

Gateway 是配置声明的。每个 gateway 声明 `capabilities`，告诉调用方它支持什么（resume、streaming 等）。

Adapter 的配置细节（command、args、环境变量等）由各 adapter 包自己定义，不在 Sumeru 层面规定。

### Session（会话）

归属于某个 gateway，是一次 agent 对话。Session 支持 resume — 多次 message 在同一个 conversation history 内延续。

**Session ID 由 Sumeru 统一管理**：`ses_` + ULID。Sumeru 内部维护到 agent native session ID 的映射（如 Hermes 的 session ID、Claude Code 的 session 等），调用方永远不接触 native ID。

Session 是运行时实体，由调用方按需创建/复用/关闭。

### Adapter（agent 适配器）

每类 agent 一个 adapter 包。不同 agent 的差异不是协议层能抹平的 — 怎么启动、怎么 resume、怎么捞 session turns，每个 agent 都不同。

| Adapter 包 | 适配 agent | 职责 |
|------------|-----------|------|
| `@sumeru/adapter-hermes` | Hermes Agent | 通过 ACP 或 CLI 通信，从 session DB 提取 turns |
| `@sumeru/adapter-claude-code` | Claude Code | 通过 CLI 通信，从 session 文件提取 turns |
| `@sumeru/adapter-openclaw` | OpenClaw | 待定 |

加新 agent = 写一个新 adapter 包。Adapter 实现统一的接口：

```typescript
type Adapter = {
  name: string

  createSession(config: Record<string, unknown>): Promise<NativeSessionRef>
  send(ref: NativeSessionRef, content: string): Promise<AgentResponse>
  close(ref: NativeSessionRef): Promise<void>
  getTurns(ref: NativeSessionRef): Promise<Turn[]>

  capabilities: { resume: boolean; streaming: boolean }
}
```

`config` 是 opaque 的 — 每个 adapter 自己定义接受什么参数。Sumeru 透传，不校验。有的 agent 支持 model 选择，有的不支持；有的有 systemPrompt，有的没有。这些都是 adapter 的内部细节。

## 三层关系

```
Sumeru Instance (一个进程，一个 endpoint)
  │
  ├─ Gateway: hermes (adapter=@sumeru/adapter-hermes)
  │    ├─ Session ses_01JXYZ → native: hermes session abc123
  │    └─ Session ses_01JXZZ → native: hermes session def456
  │
  └─ Gateway: claude-code (adapter=@sumeru/adapter-claude-code)
       └─ Session ses_01JY00 → native: claude session xyz
```

- **Instance** — 长驻服务，共享一个文件系统
- **Gateway** — 配置声明，跟随 Sumeru 生命周期
- **Session** — 运行时管理，ses_ ID 统一格式，内部映射 native ID

## 网络拓扑

小队网络 = Sumeru 网络。每个节点的 Sumeru 是该节点所有 agent 的统一入口。

```
uwf/broker (session 路由层，uwf 内部模块)
  │
  ├─ sumeru@neko ── hermes, claude-code
  ├─ sumeru@kuma ── hermes
  ├─ sumeru@raku ── hermes
  └─ sumeru@sora ── hermes
```

uwf/broker 维护 `(threadId, role) → endpoint/gateway/session` 的映射，决定消息路由到哪个 Sumeru 实例的哪个 gateway 的哪个 session。

Sumeru 不知道 uwf 的存在。它只是一个 HTTP 服务，接受请求，转发给 agent，记录结果。

## 与 uwf/broker 的分工

| | Sumeru | uwf/broker |
|---|---|---|
| 管什么 | 单个节点：gateway + session + recording | 跨节点：session 路由 + 生命周期策略 |
| 粒度 | Gateway → Session | (threadId, role) → Session 全局路由 |
| 部署 | 每个节点一个，长驻 | uwf 内部模块，嵌入 uwf 进程 |
| 知道对方吗 | 不知道 broker | 知道所有 Sumeru endpoint |

Broker 对 Sumeru 来说就是一个普通的 HTTP client。

## HTTP API

所有数据返回使用 ocas envelope 格式（structured payload + render）。

### URL 结构

```
GET  /                                        # 实例信息
GET  /gateways                                # 列出所有 gateway
GET  /gateways/:name                          # gateway 详情

GET  /sessions?q=<query>                      # 跨 gateway 搜索 session
POST /gateways/:name/sessions                 # 创建 session
GET  /gateways/:name/sessions?q=<query>       # 列出/搜索 session
GET  /gateways/:name/sessions/:id             # session 详情
DELETE /gateways/:name/sessions/:id           # 关闭 session

POST /gateways/:name/sessions/:id/messages    # 发消息
GET  /gateways/:name/sessions/:id/messages    # 消息历史

GET  /ocas/:hash                              # 访问 raw ocas 对象
```

### 实例信息

```
GET /
```

```json
{
  "name": "sumeru@neko",
  "version": "0.1.0",
  "gateways": ["hermes", "claude-code"]
}
```

### Gateway 列表

```
GET /gateways
```

```json
[
  {
    "name": "hermes",
    "adapter": "hermes",
    "status": "ready",
    "activeSessions": 2,
    "capabilities": {
      "resume": true,
      "streaming": true
    }
  }
]
```

### 创建 Session

```
POST /gateways/:name/sessions
```

```json
{
  "config": { ... }
}
```

`config` 是 opaque 的，由 adapter 定义接受什么。Sumeru 透传，不校验。

示例 — hermes gateway 可能接受：
```json
{ "config": { "model": "claude-sonnet-4", "systemPrompt": "..." } }
```

示例 — 另一个 gateway 可能只接受：
```json
{ "config": { "timeout": 300 } }
```

响应 `201`：

```json
{
  "id": "ses_01JXYZ",
  "gateway": "hermes",
  "status": "idle",
  "createdAt": "2026-06-13T12:00:00Z"
}
```

### 发消息

```
POST /gateways/:name/sessions/:id/messages
```

```json
{
  "content": "请修复 login 页面的重定向问题"
}
```

调用方发的永远是 user role，agent 回的永远是 assistant role — 不需要指定。

一次 `send` 背后 agent 可能产生多个 turn（思考→tool call→观察→再 tool call→...→最终回答）。返回格式是 **turn 级别的 SSE 流** — 每个事件是一个完整 turn，不是字符片段。

#### SSE 流格式

```
id: 1
event: turn
data: {"index": 3, "role": "assistant", "content": "让我看看 login 相关的代码...", "toolCalls": [{"tool": "terminal", "input": {"command": "cat src/auth/login.ts"}, "output": "export function login()...", "durationMs": 150}], "tokens": {"in": 1234, "out": 567}, "hash": "5MK9R2PX4KNQW"}

id: 2
event: heartbeat
data: {"elapsed": 45000, "status": "tool_call in progress"}

id: 3
event: turn
data: {"index": 4, "role": "assistant", "content": "找到问题了，redirect 逻辑有误。已修复。", "toolCalls": [{"tool": "patch", "input": {"path": "src/auth/login.ts", "old_string": "...", "new_string": "..."}, "output": "Applied.", "durationMs": 80}], "tokens": {"in": 2345, "out": 890}, "hash": "7NRT4VW8BQSM3"}

id: 4
event: done
data: {"turnCount": 2, "tokens": {"in": 3579, "out": 1457}, "durationMs": 45000}
```

#### 设计要点

- **Turn 粒度** — 每个 `event: turn` 是一个完整的语义单元（含 content、toolCalls、tokens、ocas hash）。不做字符级 streaming
- **Heartbeat 保活** — turn 之间定期发 `event: heartbeat`，防止中间代理（nginx / Cloudflare / NAT）因空闲超时掐断连接
- **断点续传** — 每个事件带 `id`（递增序号）。客户端断连后重连时发送 `Last-Event-ID` 头，Sumeru 从断点继续推送。Turn 数据在 ocas 里，重推零成本
- **`event: done`** — 标志本次 send 结束，附带汇总信息

### Session 搜索

```
GET /sessions?q=login重定向
GET /gateways/:name/sessions?q=login重定向
```

对 session 内的消息内容做语义搜索。数据源是 ocas。

```json
{
  "query": "login重定向",
  "results": [
    {
      "id": "ses_01JXYZ",
      "gateway": "hermes",
      "status": "idle",
      "relevance": 0.87,
      "matchContext": "我来看一下 login 页面的重定向问题...",
      "turns": 12,
      "lastActiveAt": "2026-06-13T12:05:00Z"
    }
  ]
}
```

使用场景：broker 查找可复用的 session，人工排查某个话题的交互历史。

MVP 用 FTS5 全文检索，后续可加 embedding。

### 消息历史

```
GET /gateways/:name/sessions/:id/messages?offset=0&limit=50
```

```json
{
  "sessionId": "ses_01JXYZ",
  "turns": [
    {
      "index": 0,
      "role": "user",
      "content": "请修复 login 页面的重定向问题",
      "timestamp": "2026-06-13T12:00:01Z",
      "toolCalls": null,
      "tokens": null
    },
    {
      "index": 1,
      "role": "assistant",
      "content": "我来看一下...",
      "timestamp": "2026-06-13T12:00:05Z",
      "toolCalls": [{ "tool": "terminal", "input": {}, "output": "...", "durationMs": 150 }],
      "tokens": { "in": 1234, "out": 567 }
    }
  ]
}
```

### 关闭 Session

```
DELETE /gateways/:name/sessions/:id
```

响应 `204`。关闭后消息历史仍可读取。

### ocas 对象访问

```
GET /ocas/:hash
```

返回 ocas envelope 格式（与其他端点一致）。用于需要底层数据的场景（调试、分析工具、跨系统集成）。

### 错误格式

```json
{
  "error": "session_not_found",
  "message": "Session ses_01JXYZ not found on gateway hermes"
}
```

| 状态码 | 场景 |
|--------|------|
| 400 | 请求格式错误 |
| 404 | gateway / session / ocas 对象不存在 |
| 409 | session 正在 active（并发发消息） |
| 502 | 底层 agent 通信失败 |
| 504 | agent 响应超时 |

## ocas 集成

所有经过收发室的消息自动写入 ocas。不需要刻意"开启录制"，录制是默认行为。

| 事件 | ocas 写入 |
|------|----------|
| 创建 session | session meta（gateway, config, createdAt） |
| 收到用户消息 | turn（role=user） |
| agent 响应 | turn（role=assistant），含 toolCalls |
| 关闭 session | 更新 session status |

Recording = session 生命周期内所有 turn 的有序集合。不是额外的数据结构，就是 ocas 里的数据本身。

所有 API 返回使用 ocas envelope 格式，同时 `/ocas/:hash` 端点提供 raw 对象访问。

## 部署模式

### 本机模式

每个小队节点跑一个 Sumeru 实例，管理本机安装的 agent。日常工作的标准模式。

### Docker 模式

启动一个 Docker 容器，容器内跑 Sumeru + agent。用于：
- 隔离实验（agent 可能 `apt install`、写系统路径）
- 观察研究（给 agent 一个干净环境，观察从零开始的行为）
- 不信任的 agent

对外仍然是一个 Sumeru endpoint，跟本机模式没区别。

### 场景实验（`sumeru run`）

原来的"观察实验室"场景 — 一种便捷的 Docker 模式：
1. 从 scene 定义创建 Docker 容器
2. 容器内启动 Sumeru + 配置 gateway
3. 发送 task prompt
4. 等待完成或 timeout
5. 导出 recording
6. 销毁容器

底层完全复用 Docker 模式的基础设施。

## Monorepo 结构（规划）

```
packages/
  core/              # @sumeru/core — 类型定义（Session, Turn, Gateway 等）
  server/            # @sumeru/server — HTTP 服务
  adapter-hermes/    # @sumeru/adapter-hermes — Hermes Agent 适配
  adapter-claude-code/ # @sumeru/adapter-claude-code — Claude Code 适配
  adapter-openclaw/  # @sumeru/adapter-openclaw — OpenClaw 适配
  cli/               # @sumeru/cli — sumeru start / run / status
```

## CLI（规划）

```bash
sumeru start                     # 启动本机 Sumeru 实例
sumeru start --config sumeru.yaml
sumeru status                    # 查看实例状态

sumeru run <scene> --gateway hermes
                                 # 一次性场景实验（Docker 模式）
```
