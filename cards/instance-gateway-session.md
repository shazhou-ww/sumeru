---
id: instance-gateway-session
title: "Instance/Gateway/Session Hierarchy"
sources:
  - README.md
  - packages/server/src/types.ts
  - packages/server/src/handler.ts
  - packages/server/src/start.ts
tags: [architecture, hierarchy, session-management]
created: 2026-06-17
updated: 2026-06-17
---

# Instance/Gateway/Session Hierarchy

Sumeru 的核心架构是一个三层模型：**Instance** → **Gateway** → **Session**。每一层都有明确的职责和生命周期。

## Three-Tier Model

```
Instance (一个进程，一个 HTTP endpoint)
  │
  ├─ Gateway: hermes (adapter = @sumeru/adapter-hermes)
  │    ├─ Session ses_01JXYZ → native: hermes session 20260614_053637_b3a39f
  │    └─ Session ses_01JXZZ → native: hermes session 20260614_053701_1f1583
  │
  └─ Gateway: claude-code (adapter = @sumeru/adapter-claude-code)
       └─ Session ses_01JY00 → native: claude session xyz
```

## Layer 1: Instance

**Instance** = 一个 Sumeru 进程 = 一个运行环境的 agent 管理层

- 每个 Instance 对外暴露 **一个 HTTP endpoint**（`host:port`）
- 由 `sumeru.yaml` 配置驱动，声明 Instance 名称和 Gateway 列表
- 进程生命周期：`sumeru start` 启动 → HTTP 服务监听 → `stop()` 关闭
- 全局配置：`workspaceRoot`（可选）用于 session cwd 解析

### Instance Type

```typescript
export type Instance = {
  name: string;           // 实例名称（如 "sumeru@local"）
  version: string;        // Sumeru 版本号
  gateways: string[];     // 注册的 gateway 名称列表
};
```

通过 `GET /` 获取 Instance 信息：

```bash
curl http://127.0.0.1:7900/
# → {"type":"@sumeru/instance","value":{"name":"sumeru@local","version":"0.1.0","gateways":["hermes"]}}
```

## Layer 2: Gateway

**Gateway** = Instance 内的一个 agent 入口，由 adapter 驱动

- 每个 Gateway 配置声明：
  - `adapter`: 使用哪个 adapter 包（如 `"hermes"`, `"claude-code"`）
  - `capabilities`: 功能标志（`resume`, `streaming`）
  - `config`: 可选的 adapter 特定配置（如超时时间、最大轮次）
- Gateway 状态：
  - `"ready"` — adapter 已注册，可创建 session
  - `"unavailable"` — adapter 未注册（配置存在但运行时缺失）
- Gateway 不持有运行时状态，仅是配置和路由层

### Gateway Type

```typescript
export type Gateway = {
  name: string;                      // gateway 名称
  adapter: string;                   // 使用的 adapter（如 "hermes"）
  status: string;                    // "ready" 或 "unavailable"
  activeSessions: number;            // 非关闭状态的 session 数量
  capabilities: GatewayCapabilities; // 功能标志
};

export type GatewayCapabilities = {
  resume: boolean;      // 是否支持断点续传
  streaming: boolean;   // 是否支持 SSE 流式响应
};
```

### Gateway Configuration

`sumeru.yaml` 中的 Gateway 配置示例：

```yaml
gateways:
  claude-code:
    adapter: claude-code
    config:
      sendTimeoutMs: 3600000          # 1 小时（默认 30 分钟）
      createSessionTimeoutMs: 300000  # 5 分钟
      maxTurns: 120                   # 默认 90
    capabilities:
      resume: true
      streaming: true
```

`config` 块完整转发给 adapter factory，server 不验证其内容。

## Layer 3: Session

**Session** = 一次 agent 对话，支持 resume（多次 message 延续同一 conversation）

- Session ID 格式：`ses_` + ULID（如 `ses_01JXYZ`）
- 每个 Session 属于一个 Gateway，由 Gateway 的 adapter 驱动
- Session 持有：
  - `config`: 创建时的 opaque 配置（如 `cwd`, `model`）
  - `status`: 当前状态（`idle`, `active`, `closed`）
  - `turnHashes`: 按时间顺序记录的所有 Turn 的 ocas 哈希
  - `metaHash`: Session 元数据的 ocas 哈希
- Session 与 native agent session 的映射通过 `NativeSessionRef` 完成

### Session Type

```typescript
export type Session = {
  id: string;               // ses_ + ULID
  gateway: string;          // 所属 gateway 名称
  status: SessionStatus;    // 当前状态
  createdAt: string;        // ISO 时间戳
  config: SessionConfig;    // 创建时的 opaque 配置
  metaHash: string;         // ocas 中的 session-meta 哈希
  turnHashes: string[];     // 按时间顺序的 Turn 哈希列表
};

export type SessionStatus = "idle" | "active" | "closed";
export type SessionConfig = Record<string, unknown>;
```

### Session State Machine

```
(none) → idle              POST /gateways/:name/sessions (创建)
idle   → active            POST .../messages 发送开始
active → idle              send 完成
idle   → closed            DELETE /gateways/:name/sessions/:id
active → closed            DELETE 时正在发送（Phase 3+）
closed → closed            幂等 DELETE
```

不允许其他状态转换。

### Session Lifecycle

1. **创建** — `POST /gateways/:name/sessions`
   - 调用 `adapter.createSession(config)` 获取 `NativeSessionRef`
   - 将 session 元数据写入 ocas（`@sumeru/session-meta` 节点）
   - 初始状态为 `idle`

2. **发消息** — `POST /gateways/:name/sessions/:id/messages`
   - 状态切换 `idle → active`
   - 调用 `adapter.send(ref, content)` 获取 Turn 列表
   - 每个 Turn 写入 ocas，hash 追加到 `turnHashes`
   - SSE 流式返回 `event: turn` / `event: done`
   - 完成后状态切换 `active → idle`

3. **关闭** — `DELETE /gateways/:name/sessions/:id`
   - 调用 `adapter.close(ref)` 通知底层 agent
   - 状态切换为 `closed`（幂等）
   - `closed` 的 session 不可再发新消息

4. **查看历史** — `GET /gateways/:name/sessions/:id/messages`
   - 从 `turnHashes` 读取 ocas 节点，按顺序返回 Turn 列表
   - 支持 `offset` / `limit` 分页

## ID Mapping: Sumeru Session ↔ Native Agent Session

Sumeru 使用统一的 `ses_<ULID>` ID，但底层 agent 有自己的 session 标识符（如 Hermes 的 `YYYYMMDD_HHMMSS_<hash>`）。

### NativeSessionRef

Adapter 返回的 `NativeSessionRef` 是桥接层：

```typescript
export type NativeSessionRef = {
  nativeId: string;                // agent 原生 session ID
  meta: Record<string, unknown>;   // adapter 特定元数据（cwd, model, …）
};
```

- Sumeru 的 `ses_` ID **从不传递给 adapter 方法**
- Server 层在内存中维护 `ses_ID → NativeSessionRef` 映射
- `NativeSessionRef` 是 **运行时状态**，不持久化到 ocas
- Server 重启后，rehydrate 的 session **历史可读但不可继续发新消息**（adapter 无法恢复运行时状态）

## HTTP API Structure

三层模型直接映射到 HTTP 路由结构：

### Instance Layer

```
GET /  → @sumeru/instance
```

### Gateway Layer

```
GET /gateways           → @sumeru/gateway-list
GET /gateways/:name     → @sumeru/gateway
```

### Session Layer

```
POST   /gateways/:name/sessions          → 201 @sumeru/session (创建)
GET    /gateways/:name/sessions          → @sumeru/session-list (列表)
GET    /gateways/:name/sessions/:id      → @sumeru/session (详情)
DELETE /gateways/:name/sessions/:id      → 204 (关闭)
POST   /gateways/:name/sessions/:id/messages  → text/event-stream (发消息)
GET    /gateways/:name/sessions/:id/messages  → @sumeru/message-history (历史)
```

路径层级清晰反映了三层模型：`/gateways/:name/sessions/:id` 表示"Instance 中的某个 Gateway 下的某个 Session"。

## Persistence & Rehydration

- **持久化**：
  - 每个 Turn 的内容存储为 ocas `@sumeru/turn` 节点
  - 每个 Session 的元数据存储为 ocas `@sumeru/session-meta` 节点
  - Session 的 `turnHashes` 数组指向该 session 的所有 Turn（按时间顺序）
  - 所有数据落在 `<ocasDir>/_store.db`（与 FTS5 索引同库）

- **重启后 Rehydration**：
  - Server 重启时，`createSessionStore` 从 ocas 读取所有 session-meta 节点
  - 之前记录过的 session 重新可见，`GET .../messages` 返回完整历史（相同 total、相同 hash、相同顺序）
  - **但** `NativeSessionRef` 是运行时状态，不落盘 → `POST .../messages` 返回 `503 adapter_unavailable`
  - 已关闭的 session 重启后仍为 `closed`；`idle`/`active` 统一恢复为 `idle`

## Design Principles

1. **配置驱动** — Instance 和 Gateway 通过 `sumeru.yaml` 声明式配置，无需编码
2. **Adapter 抽象** — Gateway 不关心底层 agent 实现，统一通过 `Adapter` 契约交互
3. **内容寻址** — 所有 Turn 和 session 元数据通过 ocas 持久化，历史不可变
4. **状态分离** — Session 的持久状态（历史）与运行时状态（`NativeSessionRef`）分离，重启后历史可读但不可继续
5. **RESTful 路由** — HTTP 路径结构直接反映三层模型，清晰易理解
