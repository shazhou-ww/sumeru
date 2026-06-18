# Sumeru Spec Checklist

> 最近更新：2026-06-18

## 目录结构

```
specs/
├── SPEC-CHECKLIST.md          ← 本文件
├── architecture/              (4)  总体架构、核心接口、脚手架
├── adapter-hermes/            (7)  Hermes adapter
├── adapter-claude-code/       (9)  Claude Code adapter
├── adapter-cursor-agent/      (7)  Cursor Agent adapter
├── adapter-codex/             (8)  Codex adapter
├── server-session/            (9)  Session 管理
├── server-sse/                (3)  SSE 消息流
├── server-ocas/               (5)  ocas 记录
├── server-search/             (3)  搜索 & 导出
├── server-config/             (8)  配置加载 & 网关端点
├── cli/                       (5)  CLI 启动生命周期
├── deploy/                    (3)  部署 & CI
└── e2e/                       (1)  端到端验收
```

共 **72** 个 spec 文件。

---

## 场景覆盖矩阵

### ✅ 完整覆盖

| 场景 | Specs | 数量 |
|---|---|---|
| 启动实例 | `cli/*` + `server-config/*` + `deploy/*` | 16 |
| 创建/管理 Session | `server-session/*` | 9 |
| 发消息 SSE 流 | `server-sse/*` | 3 |
| ocas 全量记录 | `server-ocas/*` | 5 |
| 搜索 & 导出 | `server-search/*` | 3 |
| Hermes adapter | `adapter-hermes/*` | 7 |
| Claude Code adapter | `adapter-claude-code/*` | 9 |

### 🟡 部分覆盖（有缺口）

| 场景 | 现状 | 缺口 |
|---|---|---|
| Cursor Agent adapter | 7 specs | 缺 `server-integration` |
| Codex adapter | 8 specs | `stream-parser` 是 placeholder |
| 重启恢复 | 在持久化 spec + architecture 中描述 | 缺 503 错误处理、状态恢复独立 spec |
| E2E 验收 | 仅 hermes | 缺 claude-code / cursor / codex / 多 gateway |

### ❌ 完全空白

| 场景 | 说明 |
|---|---|
| Docker 模式 | architecture 描述了容器隔离实验，零 spec |
| `sumeru run` 场景实验 | scene 定义→容器→执行→导出→销毁，零 spec |
| `sumeru prompt` 子命令 | Issue #47 待做 |
| `sumeru status` / `sumeru stop` | architecture 提到但无 spec |
| SSE error 事件格式 | architecture 提到 `event: error`，无独立定义 |
| 并发发消息 409 场景 | 状态机提到但无场景 spec |

---

## E2E 测试候选（不调用 LLM）

以下 spec 可以用 mock adapter / 固定数据做自动化测试，不需要真实 agent。

### 🔵 纯逻辑 / Mock 友好

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `server-config/config-load-yaml` | 解析各种 YAML 输入，验证类型校验 | P0 |
| `server-config/config-load-workspace-root` | workspaceRoot 解析 + null 缺省 | P0 |
| `server-config/config-load-gateway-config-blob` | opaque config 透传，畸形输入拒绝 | P0 |
| `server-session/server-session-id-ulid` | ses_ + ULID 格式验证 | P0 |
| `server-session/server-session-status-state-machine` | idle→active→idle/closed 状态转换 + 409 并发 | P0 |
| `server-session/server-session-resolve-cwd` | cwd 解析 + workspaceRoot 路径限制 | P1 |
| `server-session/server-session-turns-table` | DB 迁移幂等性 | P1 |
| `server-session/server-session-turnhashes-persistence` | 写入→重启→rehydrate 一致性 | P1 |

### 🔵 HTTP 端点（mock adapter）

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `server-config/server-instance-endpoint` | GET / 返回 instance envelope | P0 |
| `server-config/server-instance-endpoint-config` | gateways 列表反映配置 | P0 |
| `server-config/server-gateways-list-endpoint` | GET /gateways | P0 |
| `server-config/server-gateway-detail-endpoint` | GET /gateways/:name + 404 + 路径穿越 | P0 |
| `server-session/server-session-create-endpoint` | POST sessions + config 透传 | P0 |
| `server-session/server-session-detail-endpoint` | GET session + 404 | P0 |
| `server-session/server-session-delete-endpoint` | DELETE + 幂等 | P0 |
| `server-session/server-sessions-list-endpoint` | GET sessions 列表 | P1 |

### 🔵 SSE & 消息历史（mock adapter）

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `server-sse/server-message-sse-endpoint` | mock send → turn/heartbeat/done 事件流 | P1 |
| `server-sse/server-message-sse-resume` | Last-Event-ID 断点续传 + 410 超时 | P1 |
| `server-sse/server-message-history-endpoint` | GET messages 分页 + 有序 | P1 |

### 🔵 ocas 存储 & 记录（不需要 agent）

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `server-ocas/server-ocas-store-bootstrap` | 启动初始化 + schema 注册 | P1 |
| `server-ocas/server-ocas-schemas` | JSON Schema 校验 | P1 |
| `server-ocas/server-ocas-session-meta` | 创建/关闭 → meta 写入 | P1 |
| `server-ocas/server-ocas-turn-recording` | turn → ocas + hash | P1 |
| `server-ocas/server-ocas-object-endpoint` | GET /ocas/:hash + schema 别名解析 | P2 |

### 🔵 搜索 & 导出（固定数据）

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `server-search/server-fts5-index` | turn 写入 → FTS 索引同步 | P1 |
| `server-search/server-search-endpoint` | FTS5 检索 + 相关度排序 | P1 |
| `server-search/server-session-export-endpoint` | 导出 tar.gz 自包含验证 | P2 |

### 🔵 CLI 生命周期（子进程管理）

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `cli/server-start-listens` | 启动 → 端口监听 → 退出 | P1 |
| `cli/cli-pid-file` | 写入 → 校验 → 清理 | P1 |
| `cli/cli-startup-port-check` | EADDRINUSE 诊断 + --force | P2 |
| `cli/cli-graceful-shutdown` | SIGTERM → 优雅退出 | P2 |

### 🔵 Stream Parser（录制数据回放）

| Spec | 测试方式 | 优先级 |
|---|---|---|
| `adapter-claude-code/adapter-claude-code-stream-parser` | 录制 NDJSON → Turn[] | P1 |
| `adapter-cursor-agent/adapter-cursor-agent-stream-parser` | 录制 stream-json → Turn[] | P1 |
| `adapter-codex/adapter-codex-stream-parser` | 录制 JSONL → Turn[]（spec 当前 placeholder） | P2 |

### ⚠️ 需要真实 agent（不适合自动化 e2e）

| Spec | 原因 |
|---|---|
| `adapter-hermes/*` (create-session/send/get-turns) | 需要真实 hermes 进程 |
| `adapter-claude-code/*` (create-session/send) | 需要真实 claude-code CLI |
| `adapter-cursor-agent/*` (create-session/send) | 需要真实 cursor-agent CLI |
| `adapter-codex/*` (create-session/send) | 需要真实 codex CLI |
| `e2e/e2e-hermes-roundtrip` | 完整往返需要真实 hermes |

> 注：各 adapter 的 `close`、`get-turns`、`cwd`、`timeout-config` 等可以用 mock 子进程测试，但投入产出比需评估。

---

## 缺口 TODO

### 需要新写 spec

- [ ] `docker-mode` — Docker 隔离模式架构 spec
- [ ] `sumeru-run-scene` — 场景实验 CLI spec
- [ ] `sumeru-prompt` — Issue #47，对标 uwf prompt
- [ ] `cli-status` — `sumeru status` 命令
- [ ] `cli-stop` — `sumeru stop` 命令
- [ ] `server-sse-error-event` — SSE error 事件格式定义
- [ ] `server-session-concurrent-409` — 并发发消息场景
- [ ] `adapter-cursor-agent/server-integration` — 补齐 server-integration
- [ ] `adapter-codex/stream-parser-v2` — spike 完成后补全 stream-parser

### 需要补 E2E

- [ ] `e2e/claude-code-roundtrip` — CC 完整往返
- [ ] `e2e/cursor-agent-roundtrip` — Cursor Agent 完整往返
- [ ] `e2e/codex-roundtrip` — Codex 完整往返
- [ ] `e2e/multi-gateway` — 多 gateway 并行会话
- [ ] `e2e/server-restart-rehydrate` — 重启恢复 + 503 验证
- [ ] `e2e/sse-resume-reconnect` — SSE 断线重连

### 待走查（spec → 实现验证）

- [ ] architecture/ — 4 specs
- [ ] adapter-hermes/ — 7 specs
- [ ] adapter-claude-code/ — 9 specs
- [ ] adapter-cursor-agent/ — 7 specs
- [ ] adapter-codex/ — 8 specs
- [ ] server-session/ — 9 specs
- [ ] server-sse/ — 3 specs
- [ ] server-ocas/ — 5 specs
- [ ] server-search/ — 3 specs
- [ ] server-config/ — 8 specs
- [ ] cli/ — 5 specs
- [ ] deploy/ — 3 specs
- [ ] e2e/ — 1 spec
