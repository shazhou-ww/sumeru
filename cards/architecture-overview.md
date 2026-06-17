---
id: architecture-overview
title: "Sumeru Architecture Overview"
sources:
  - CLAUDE.md
  - README.md
  - packages/core/src/types.ts
  - packages/core/src/adapter.ts
  - packages/server/src/types.ts
tags: [architecture, monorepo, packages]
created: 2026-06-17
updated: 2026-06-17
---

# Sumeru Architecture Overview

**Agent house** — Sumeru 是一个 HTTP 服务，为同一运行环境内的多个 agent 提供统一的收发室，所有交互通过 ocas 全量记录。

> 芥子纳须弥 — 一粒芥子里装一座须弥山

## Monorepo Structure

Sumeru 是一个 TypeScript monorepo，采用 pnpm workspace 管理，包依赖关系从核心向外扩展：

```
@sumeru/core (类型定义)
    ↓
@sumeru/server (HTTP 服务 + Instance/Gateway/Session 管理)
    ↓
@sumeru/adapter-* (具体 agent 适配器实现)
    ↓
@sumeru/cli (命令行工具)
```

### Package 职责

| Package | 路径 | 职责 |
|---------|------|------|
| `@sumeru/core` | `packages/core` | 核心类型定义：`Adapter` 契约、`Turn`、`Session` 类型、`TokenUsage` 等 |
| `@sumeru/server` | `packages/server` | HTTP 服务实现：Instance、Gateway、Session 生命周期管理、SSE 消息流、ocas 持久化、FTS5 搜索 |
| `@sumeru/adapter-hermes` | `packages/adapter-hermes` | Hermes Agent 适配器 |
| `@sumeru/adapter-claude-code` | `packages/adapter-claude-code` | Claude Code Agent 适配器 |
| `@sumeru/cli` | `packages/cli` | CLI 工具：`sumeru start`、adapter 注册表构建、端口检查、PID 文件管理 |

### 依赖流向

- **`core`** — 零依赖，纯类型定义包，定义 `Adapter` 契约和 `Turn`/`Session` 数据结构
- **`server`** — 依赖 `@sumeru/core` 和 `@ocas/core`，实现 HTTP 服务层和会话管理
- **`adapter-*`** — 依赖 `@sumeru/core`，实现具体 agent 的 `Adapter` 契约
- **`cli`** — 依赖 `@sumeru/server` 和所有 adapter 包，提供启动入口和 adapter 注册表

## Core Concepts

### 三层模型

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

- **Instance** — 一个 Sumeru 进程 = 一个运行环境的 agent 管理层，对外暴露一个 HTTP endpoint
- **Gateway** — Instance 内的一个 agent 入口，由 adapter 驱动，配置声明 capabilities (resume/streaming)
- **Session** — 一次 agent 对话，`ses_` + ULID，支持 resume（多次 message 延续同一 conversation）
- **Adapter** — 每类 agent 一个包，实现 `createSession` / `send` / `close` / `getTurns` 方法

### Adapter 契约

`@sumeru/core` 定义的 `Adapter` 类型是整个架构的抽象层：

```typescript
export type Adapter = {
  name: string;
  capabilities: AdapterCapabilities;
  createSession(config: Record<string, unknown>): Promise<NativeSessionRef>;
  send(ref: NativeSessionRef, content: string): Promise<AgentResponse>;
  close(ref: NativeSessionRef): Promise<void>;
  getTurns(ref: NativeSessionRef): Promise<Turn[]>;
};
```

Server 通过统一的 `Adapter` 接口与各类 agent 交互，adapter 负责将 Sumeru 的标准 `Turn` 格式与底层 agent 的原生格式互译。

### Turn 数据结构

所有 agent 交互的最小单元是 `Turn`（定义在 `@sumeru/core`）：

```typescript
export type Turn = {
  index: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: ToolCall[] | null;
  tokens: TokenUsage | null;
  hash: string | null;  // server 填充，adapter 返回 null
};
```

每个 Turn 都通过 ocas 内容寻址存储，`hash` 字段由 server 计算后注入。

## Tech Stack

- **Runtime:** Node.js 24
- **Language:** TypeScript (strict mode)
- **Build:** `tsc` + composite project references (via `@shazhou/proman`)
- **Test:** Vitest
- **Package Manager:** pnpm workspace
- **Lint/Format:** Biome
- **Publish:** `@shazhou/proman`

## Code Conventions

### TypeScript 规范

- **Strict mode** — 无 `any`，无未检查索引访问
- **`type` over `interface`** — 所有类型定义使用 `type`
- **`function` over `class`** — 纯函数 + 闭包，禁用 class
- **Named exports only** — 禁止 default export
- **Import paths** — 使用 `.js` 扩展名（ESM 约定）

### 命名规范

| 类型 | 风格 | 示例 |
|------|------|------|
| 文件 | kebab-case | `run-config.ts` |
| 类型 | PascalCase | `Turn`, `Adapter` |
| 函数/变量 | camelCase | `createSession`, `startServer` |
| 常量 | UPPER_SNAKE | `DEFAULT_TIMEOUT` |

### 模块组织

- 每个文件夹通过 `index.ts` 导出
- 类型定义放在 `types.ts`
- `index.ts` 仅做纯转发导出
- 禁用可选属性（`?:`），使用 `T | null` 替代

## Build & Release

```bash
pnpm run build     # 通过 proman 构建所有包
pnpm run test      # 运行所有测试
pnpm run check     # Biome lint
pnpm run format    # Biome format
```

发布流程使用 `@shazhou/proman`：在 `.changeset/` 添加 changeset，然后 `proman bump` → `proman publish`。

## Network Topology

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
