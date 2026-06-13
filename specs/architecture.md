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
    adapter: acp
    command: hermes
    args: ["chat"]
    capabilities:
      resume: true
      streaming: true

  claude-code:
    adapter: cli
    command: claude
    capabilities:
      resume: true
      streaming: false
```

Gateway 是配置声明的，不是运行时动态发现的。每个 gateway 声明 `capabilities`，告诉调用方它支持什么（resume、streaming 等）。

### Session（会话）

归属于某个 gateway，是一次 agent 对话。Session 支持 resume — 多次 `send` 在同一个 conversation history 内延续。

Session 是运行时实体，由调用方按需创建/复用/关闭。

### Adapter（通信协议）

Gateway 内部通过 adapter 与 agent 通信。Adapter 是代码层面的 plugin，每种协议一个实现：

| Adapter | 通信方式 | 适用 agent |
|---------|---------|-----------|
| `acp` | Agent Communication Protocol | Hermes, 任何 ACP-compatible agent |
| `cli` | fork 进程 + stdin/stdout | Claude Code, Codex |

加新 agent 不写代码（如果已有合适的 adapter），写 gateway 配置就行。加新协议写一个 adapter。

## 三层关系

```
Sumeru Instance (一个进程，一个 endpoint)
  │
  ├─ Gateway: hermes (adapter=acp)
  │    ├─ Session ses_01JXYZ (active)
  │    └─ Session ses_01JXZZ (idle)
  │
  └─ Gateway: claude-code (adapter=cli)
       └─ Session ses_01JY00 (active)
```

- **Instance** — 长驻服务，共享一个文件系统
- **Gateway** — 配置声明，跟随 Sumeru 生命周期
- **Session** — 运行时管理，按需创建/复用/回收

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
    "adapter": "acp",
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
  "config": {
    "model": "claude-sonnet-4",
    "systemPrompt": "你是一个 developer...",
    "timeout": 300
  }
}
```

`config` 透传给 adapter → agent，Sumeru 不校验。不同 agent 接受不同参数。

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
  "role": "user",
  "content": "请修复 login 页面的重定向问题"
}
```

阻塞模式 — 等 agent 完成后返回：

```json
{
  "role": "assistant",
  "content": "我来看一下 login 相关的代码...",
  "toolCalls": [
    {
      "tool": "terminal",
      "input": { "command": "cat src/auth/login.ts" },
      "output": "...",
      "durationMs": 150
    }
  ],
  "tokens": { "in": 1234, "out": 567 }
}
```

流式模式（`Accept: text/event-stream`）— SSE：

```
event: content
data: {"delta": "我来看一下 login 相关的代码..."}

event: tool_call
data: {"tool": "terminal", "input": {...}, "output": "...", "durationMs": 150}

event: done
data: {"tokens": {"in": 1234, "out": 567}}
```

MVP 先做阻塞模式。

### Session 搜索

```
GET /sessions?q=login重定向
GET /gateways/:name/sessions?q=login重定向
```

对 session 内的消息内容做语义搜索。数据源是 ocas recording。

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
| 404 | gateway / session 不存在 |
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
  core/          # @sumeru/core — 类型定义
  server/        # @sumeru/server — HTTP 服务
  adapter-acp/   # @sumeru/adapter-acp — ACP 协议适配
  adapter-cli/   # @sumeru/adapter-cli — CLI 协议适配
  cli/           # @sumeru/cli — sumeru start / run / status
```

## CLI（规划）

```bash
sumeru start                     # 启动本机 Sumeru 实例
sumeru start --config sumeru.yaml
sumeru status                    # 查看实例状态

sumeru run <scene> --gateway hermes --model claude-sonnet-4
                                 # 一次性场景实验（Docker 模式）
```
