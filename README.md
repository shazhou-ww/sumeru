# Sumeru 🏔️

> 芥子纳须弥 — 一粒芥子里装一座须弥山

**Agent house** — 一个 HTTP 服务，为同一运行环境内的多个 agent 提供统一的收发室，所有交互通过 ocas 全量记录。

## 核心概念

```
Instance (一个进程，一个 endpoint)
  │
  ├─ Gateway: hermes (adapter = @sumeru/adapter-hermes)
  │    ├─ Session ses_01JXYZ → native: hermes session 20260614_053637_b3a39f
  │    └─ Session ses_01JXZZ → native: hermes session 20260614_053701_1f1583
  │
  └─ Gateway: claude-code (adapter = @sumeru/adapter-claude-code)
       └─ Session ses_01JY00 → native: claude session xyz
```

- **Instance** — 一个 Sumeru 进程，一个运行环境的 agent 管理层，对外暴露一个 HTTP endpoint
- **Gateway** — Instance 内的一个 agent 入口，由 adapter 驱动，配置声明 capabilities
- **Session** — 一次 agent 对话，`ses_` + ULID，支持 resume（多次 message 延续同一 conversation）
- **Adapter** — 每类 agent 一个包，实现 `createSession` / `send` / `close` / `getTurns`

## Quick Start

```bash
# 1. 创建实例配置
cat > sumeru.yaml << 'EOF'
name: sumeru@local

gateways:
  hermes:
    adapter: hermes
    capabilities:
      resume: true
      streaming: true
EOF

# 2. 启动服务
sumeru start -c sumeru.yaml -p 7900

# 3. 验证
curl http://127.0.0.1:7900/
# → {"type":"@sumeru/instance","value":{"name":"sumeru@local","version":"0.1.0","gateways":["hermes"]}}
```

## HTTP API

所有响应使用 ocas envelope 格式 `{ type, value }`。

### 实例信息

```
GET /  → @sumeru/instance
```

### Gateway

```
GET /gateways           → @sumeru/gateways (列出所有 gateway)
GET /gateways/:name     → @sumeru/gateway  (单个 gateway 详情)
```

### Session

```
POST   /gateways/:name/sessions          → 201 @sumeru/session (创建)
GET    /gateways/:name/sessions/:id      → @sumeru/session     (查看)
GET    /gateways/:name/sessions/:id/messages → @sumeru/message-history (历史)
DELETE /gateways/:name/sessions/:id      → 204                 (关闭)
```

### 发消息 (SSE)

```
POST /gateways/:name/sessions/:id/messages  → text/event-stream
```

请求 body: `{ "content": "你的消息" }`

SSE 事件流：
- `event: turn` — 完整的 Turn 对象 `{ index, role, content, timestamp, hash }`
- `event: heartbeat` — 保活
- `event: done` — 完成，附带 summary `{ turnCount, tokens, durationMs }`
- `event: error` — 错误

支持 `Last-Event-ID` header 断点续传。

### 搜索 & 导出

```
GET  /sessions?q=keyword&gateway=hermes  → FTS5 全文搜索
POST /gateways/:name/sessions/:id/export → tar.gz 导出
```

### 持久化 & 重启

所有 turn 内容、session-meta，以及每个 session 的 **有序 turn 列表指针** 都落在
`<ocasDir>/_store.db`（与 FTS5 索引同库）。server 重启后 `createSessionStore`
会从盘上 rehydrate：之前记录过的 session 重新可见，`GET .../messages` 返回的历史
与重启前完全一致（相同 total、相同 hash、相同顺序）。

注意：adapter 侧的 `NativeSessionRef` 是运行时状态、不落盘——rehydrate 出来的
session 历史可读但不可继续发新消息，`POST .../messages` 会返回
`503 adapter_unavailable`。已关闭的 session 重启后仍为 `closed`；idle/active 统一
恢复为 `idle`（重启不可能让一次发送悬在半途）。

## Packages

| Package | Description |
|---------|-------------|
| `@sumeru/core` | Core type definitions (Adapter, Turn, Session types) |
| `@sumeru/server` | HTTP service (Instance, Gateway, Session management) |
| `@sumeru/adapter-hermes` | Adapter for Hermes Agent |
| `@sumeru/adapter-claude-code` | Adapter for Claude Code CLI |
| `@sumeru/adapter-cursor-agent` | Adapter for Cursor Agent CLI |
| `@sumeru/cli` | CLI tool (`sumeru start`) |

## Configuration

Each `gateways.<name>` entry supports an optional `config:` block. The block
is forwarded verbatim to the adapter factory at boot — the YAML loader does
not validate keys against any adapter's schema, so adapter-specific options
pass through. Example: raise the claude-code adapter's `send` timeout from
the 30-minute default to 1 hour for very long tasks:

```yaml
gateways:
  claude-code:
    adapter: claude-code
    config:
      sendTimeoutMs: 3600000          # 1 h (default 30 min)
      createSessionTimeoutMs: 300000  # 5 min (default 5 min)
      maxTurns: 120                   # default 90
    capabilities:
      resume: true
      streaming: true
```

Omit `config:` entirely (or set it to `null` / `{}`) to keep the adapter's
built-in defaults. Unknown keys are passed through but ignored by the
adapter; non-mapping values (numbers, arrays) are rejected at load time.

## Development

```bash
pnpm install
pnpm run build     # tsc via proman
pnpm run test      # vitest
pnpm run check     # biome lint
```

## 网络拓扑

每个小队节点跑一个 Sumeru 实例，小队网络 = Sumeru 网络：

```
uwf/broker (session 路由层)
  │
  ├─ sumeru@neko ── hermes, claude-code
  ├─ sumeru@kuma ── hermes
  ├─ sumeru@raku ── hermes
  └─ sumeru@sora ── hermes
```

详细设计见 [specs/architecture.md](specs/architecture.md)。

## Name

> 须弥山 — 佛教宇宙观中的世界中心。一粒芥子里装一座须弥山 — 一个小小的 HTTP 服务里，容纳了整个 agent 世界。
