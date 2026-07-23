# Sumeru — Scenario 总纲

> 按功能域组织，每个场景同时列出 API 端点和对应 CLI 命令。
> CLI 标注说明：`—` = 不适用（by design），`🚧 #N` = 缺失已开 issue 跟进。
> Spec 列标注说明：`✅ atest` = 已有 atest YAML 覆盖，`📝 vitest` = adapter/SSE/protocol 层由 vitest 覆盖，`📋 spec` = 仅 spec.md（tc 已删，待补 YAML）。

> **CLI Initialization:** CLI uses lazy initialization (auto-creates ~/.sumeru/ on first command) and lazy start (auto-spawns host when needed). No setup command required.

> **Host/Port:** Host/port configured via SUMERU_HOST/SUMERU_PORT environment variables (default 127.0.0.1:7900)

---

# Part I — Host 本体（API + CLI E2E）

---

## 1. Host 状态

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 1.1 | 查询 Host 状态 | `GET /` | `sumeru server status` | [host/root-status/spec.md](./host/root-status/spec.md) |
| 1.2 | 启动 Host 进程 | — | `sumeru server start` | [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md) |
| 1.3 | 停止 Host 进程 | — | `sumeru server stop` | [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md) |
| 1.4 | 重启 Host 进程 | — | `sumeru server restart` | [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md) |

---

## 2. Session 生命周期

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 2.1 | 创建 session（happy path） | `POST /sessions` | `sumeru session add <proto> [--project <p>] [--task <t>]` | ✅ atest: `specs/atest/session-lifecycle.test.yaml` |
| 2.2 | 创建 session（minimal, no project/task） | `POST /sessions` (`project`/`task` omitted) | `sumeru session add <proto>` | ✅ atest: `specs/atest/session-create-no-task.test.yaml` |
| 2.3 | 创建 session（prototype 不存在） | `POST /sessions` → 404 | `sumeru session add ghost` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 2.4 | 创建 session（project 路径越界） | `POST /sessions` → 400 | — (CLI 不直传越界路径) | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 2.5 | 列出所有 sessions | `GET /sessions` | `sumeru session list` | ✅ atest: `specs/atest/session-lifecycle.test.yaml` |
| 2.6 | 获取 session 详情 | `GET /sessions/:id` | `sumeru session get <id>` | ✅ atest: `specs/atest/session-lifecycle.test.yaml` |
| 2.7 | 停止 running session | `POST /sessions/:id/stop` | `sumeru session stop <id>` | ✅ atest: `specs/atest/session-lifecycle.test.yaml` |
| 2.8 | 停止已 idle session（409） | `POST /sessions/:id/stop` → 409 | `sumeru session stop <id>` → error | ✅ atest: `specs/atest/session-lifecycle.test.yaml` + `errors/error-paths.test.yaml` |
| 2.9 | 删除 idle session | `DELETE /sessions/:id` | `sumeru session remove <id>` | ✅ atest: `specs/atest/session-lifecycle.test.yaml` |
| 2.10 | 删除 running session | `DELETE /sessions/:id` | `sumeru session remove <id>` | ✅ atest: `specs/atest/session-delete-running.test.yaml` |
| 2.11 | 并发排队（FIFO） | `POST /sessions`（满额时阻塞） | — (Host 内部调度，非用户可控操作) | [session/concurrency-fifo-queue/spec.md](./session/concurrency-fifo-queue/spec.md) |

---

## 3. Session 多轮恢复

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 3.1 | 向 idle session 发消息恢复执行 | `POST /sessions/:id/messages` | `sumeru session send <id> "msg"` | ✅ atest: `specs/atest/session-lifecycle.test.yaml` |
| 3.2 | 向 running session 发消息（409） | `POST /sessions/:id/messages` → 409 | `sumeru session send <id> "msg"` → error | [resume/message-resume-idle.md](./resume/message-resume-idle.md) |
| 3.3 | 发消息时切换 Model（hot-switch） | `POST /sessions/:id/messages` + `"model":"..."` | 🚧 [#246](https://git.shazhou.work/shazhou/sumeru/issues/246) `--model` flag 缺失 | [resume/model-hot-switch.md](./resume/model-hot-switch.md) |
| 3.4 | 发消息时注入环境变量 | `POST /sessions/:id/messages` + `"env":{...}` | 🚧 [#246](https://git.shazhou.work/shazhou/sumeru/issues/246) `--env` flag 缺失 | 📋 spec 待补 (#246 blocks) |

---

## 4. SSE 事件流

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 4.1 | 订阅 session 事件流 | `GET /sessions/:id/events` | `sumeru session logs <id> --follow` | [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md) |
| 4.2 | Turn 事件（assistant turn） | `event: turn` | `sumeru session logs <id>` 输出 | [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md) |
| 4.3 | Exit 事件（关闭流） | `event: exit` | `sumeru session logs <id>` 输出 | [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md) |
| 4.4 | Heartbeat 事件 | `event: heartbeat` | — (CLI 内部消费，不显示) | [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md) |
| 4.5 | Last-Event-ID 断线重连 | `GET /sessions/:id/events` + `Last-Event-ID` header | — (协议层行为，CLI `logs --follow` 内部实现) | [sse/last-event-id-resume/spec.md](./sse/last-event-id-resume/spec.md) |
| 4.6 | Turn tokenUsage 字段 | turn 事件内 `tokenUsage` | — (数据字段，`logs` 输出中展示) | [sse/turn-event-token-usage/spec.md](./sse/turn-event-token-usage/spec.md) |
| 4.7 | Turn durationMs 字段 | turn 事件内 `durationMs` | — (数据字段，`logs` 输出中展示) | [sse/turn-event-duration-ms/spec.md](./sse/turn-event-duration-ms/spec.md) |

---

## 5. Turns 查询

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 5.1 | 全量查询 turns | `GET /sessions/:id/turns` | `sumeru session turns <id>` | ✅ atest: `specs/atest/turns-turns-pagination.test.yaml` |
| 5.2 | 分页查询（after=N） | `GET /sessions/:id/turns?after=N` | `sumeru session turns <id> --after N` | ✅ atest: `specs/atest/turns-turns-pagination.test.yaml` |
| 5.3 | Turn discriminated union | turn 结构区分 assistant / tool | — (数据结构定义，非独立操作) | [turns/turn-discriminated-union/spec.md](./turns/turn-discriminated-union/spec.md) |
| 5.4 | 时间过滤（before=ISO） | `GET /sessions/:id/turns?before=<ISO>` | — (watch 内部使用) | [session/turns-watch/spec.md](./session/turns-watch/spec.md) |
| 5.5 | Watch 实时监视 | `GET /sessions/:id/turns/watch` (SSE) | `sumeru session turns <id> -w` | [session/turns-watch/spec.md](./session/turns-watch/spec.md) |
| 5.6 | Watch 输出格式一致性 | — | `turns` 与 `turns -w` 格式一致 | [session/turns-watch/tc-format-consistency.md](./session/turns-watch/tc-format-consistency.md) |
| 5.7 | Turns 显示 tool calls | — | assistant turn 带 tool call 时显示 `→ name(args)` | [session/turns-watch/tc-format-consistency.md](./session/turns-watch/tc-format-consistency.md) |

---

## 6. Registry — Provider

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 6.1 | 列出 providers | `GET /providers` | `sumeru provider list` | ✅ atest: `specs/atest/provider-crud-lifecycle.test.yaml` |
| 6.2 | 获取 provider 详情 | `GET /providers/:name` | `sumeru provider get <name>` | ✅ atest: `specs/atest/provider-crud-lifecycle.test.yaml` |
| 6.3 | 创建 provider | `PUT /providers/:name` | `sumeru provider add <name> --api-type --base-url` | ✅ atest: `specs/atest/provider-crud-lifecycle.test.yaml` |
| 6.4 | 更新 provider | `PUT /providers/:name` | `sumeru provider update <name> --api-type/--base-url/--api-key` | ✅ atest: `specs/atest/provider-crud-lifecycle.test.yaml` |
| 6.5 | 删除 provider | `DELETE /providers/:name` | `sumeru provider remove <name>` | ✅ atest: `specs/atest/provider-crud-lifecycle.test.yaml` |
| 6.6 | 删除被 Model 引用的 provider（409） | `DELETE /providers/:name` → 409 | `sumeru provider remove <name>` → error | ✅ atest: `specs/atest/provider-crud-lifecycle.test.yaml` |

---

## 7. Registry — Model

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 7.1 | 列出 models | `GET /models` 或 `GET /providers/:name/models` | `sumeru model list [--provider <name>]` | ✅ atest: `specs/atest/model-crud-lifecycle.test.yaml` |
| 7.2 | 获取 model 详情 | `GET /providers/:name/models/:modelName` | `sumeru model get <provider:name>` | ✅ atest: `specs/atest/model-crud-lifecycle.test.yaml` |
| 7.3 | 创建 model | `PUT /providers/:name/models/:modelName` | `sumeru model add <provider:name> --model <api-model>` | ✅ atest: `specs/atest/model-crud-lifecycle.test.yaml` |
| 7.4 | 更新 model | `PUT /providers/:name/models/:modelName` | `sumeru model update <provider:name> --model/--context-window` | ✅ atest: `specs/atest/model-crud-lifecycle.test.yaml` |
| 7.5 | 删除 model | `DELETE /providers/:name/models/:modelName` | `sumeru model remove <provider:name>` | ✅ atest: `specs/atest/model-crud-lifecycle.test.yaml` |

---

## 8. Registry — Persona

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 8.1 | 列出 personas | `GET /personas` | `sumeru persona list` | ✅ atest: `specs/atest/persona-crud-lifecycle.test.yaml` |
| 8.2 | 获取 persona 详情 | `GET /personas/:name` | `sumeru persona get <name>` | ✅ atest: `specs/atest/persona-crud-lifecycle.test.yaml` |
| 8.3 | 创建 persona | `PUT /personas/:name` | `sumeru persona add <name> --instructions` | ✅ atest: `specs/atest/persona-crud-lifecycle.test.yaml` |
| 8.4 | 删除 persona | `DELETE /personas/:name` | `sumeru persona remove <name>` | ✅ atest: `specs/atest/persona-crud-lifecycle.test.yaml` |
| 8.5 | 删除被 Prototype 引用的 persona（409） | `DELETE /personas/:name` → 409 | `sumeru persona remove <name>` → error | 📋 spec 待补 |

---

## 9. Registry — Prototype

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 9.1 | 列出 prototypes | `GET /prototypes` | `sumeru prototype list` | ✅ atest: `specs/atest/prototype-crud-lifecycle.test.yaml` |
| 9.2 | 删除 prototype | `DELETE /prototypes/:name` | `sumeru prototype remove <name>` | ✅ atest: `specs/atest/prototype-crud-lifecycle.test.yaml` |

---

## 10. Adapter — 可观测面

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 10.1 | 列出 adapters | `GET /adapters` | `sumeru adapter list` | ✅ atest: `specs/atest/adapter-adapter-list.test.yaml` |
| 10.2 | 获取 adapter 详情 | `GET /adapters/:name` | `sumeru adapter get <name>` | ✅ atest: `specs/atest/adapter-adapter-list.test.yaml` |
| 10.3 | 列出 adapter 内置模型 | `GET /adapters/:name/models` | `sumeru adapter models <name>` | 📋 spec 待补 |

---

## 11. In-Session Commands

> 所有操作收归 `sumeru session` 子命令。

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 11.1 | 发消息（唯一入口） | `POST /sessions/:id/messages` | `sumeru session send <id> "msg" [--model] [--env]` | [resume/message-resume-idle.md](./resume/message-resume-idle.md) |
| 11.2 | 容器内执行 shell | `POST /sessions/:id/commands` `{"type":"exec",...}` | `sumeru session exec <id> -- <command...>` | ✅ atest: `specs/atest/session-commands.test.yaml` |
| 11.3 | 切换 model | `POST /sessions/:id/commands` `{"type":"model",...}` | `sumeru session model <id> <model-id>` | ✅ atest: `specs/atest/session-commands.test.yaml` |
| 11.4 | 清上下文 | `POST /sessions/:id/commands` `{"type":"reset",...}` | `sumeru session reset <id> [--persona]` | ✅ atest: `specs/atest/session-commands.test.yaml` |
| 11.5 | snapshot（docker commit） | `POST /sessions/:id/commands` `{"type":"snapshot",...}` | `sumeru session snapshot <id> <name>` | ✅ atest: `specs/atest/session-commands.test.yaml` |
| 11.6 | snapshot 输出可读性 | — | `sumeru session snapshot` 多行格式 | ✅ atest: `specs/atest/session-commands.test.yaml` |

---

## 12. Search

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 12.1 | ~~全文搜索 sessions~~ | ~~`GET /search?q=...`~~ | ~~`sumeru search <query>`~~ | ~~已移除 ([#256](https://git.shazhou.work/shazhou/sumeru/issues/256))~~ |

---

## 13. 错误契约

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 13.1 | 400 Invalid JSON | 所有 POST/PUT 端点 | 所有写命令 → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.2 | 400 Missing fields | `POST /sessions` 缺必填 | `sumeru session add` 缺参数 → help 提示 | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.3 | 400 Invalid project | `POST /sessions` 路径越界 | — (路径校验在 Host 侧) | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.4 | 404 Session not found | `GET/POST/DELETE /sessions/:id` | `sumeru session get/stop/remove <id>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.5 | 404 Prototype not found | `POST /sessions`, `GET /prototypes/:name` | `sumeru session add`, `sumeru prototype get` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.6 | 409 Session already idle | `POST /sessions/:id/stop` | `sumeru session stop <id>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.7 | 409 Provider in use | `DELETE /providers/:name` | `sumeru provider remove <name>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 13.8 | Host 未启动时操作 | `ECONNREFUSED` | 所有命令 → 友好错误提示 | [cli/error-experience/spec.md](./cli/error-experience/spec.md) |

---

## 14. Host 韧性

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 14.1 | unhandledRejection 守卫 | — (进程级) | — (内部行为) | [host/unhandled-rejection-guard.md](./host/unhandled-rejection-guard.md) |
| 14.2 | markIdle 缺失 session 守卫 | — (内部) | — (内部行为) | [host/mark-idle-missing-session-guard.md](./host/mark-idle-missing-session-guard.md) |
| 14.3 | Adapter 异常退出后 Host 存活 | — (端到端不变量) | — (内部行为) | [host/adapter-abnormal-exit-resilience.md](./host/adapter-abnormal-exit-resilience.md) |
| 14.4 | Host 重启后 session 上下文恢复 | — (adapter JSONL 持久化) | `server restart` → `session send` 上下文不丢 | ✅ atest: `specs/atest/resume-after-restart.test.yaml` |

---

# Part II — Adapter 协议（各 Adapter 内部 E2E）

> 以下验证的是 adapter 二进制自身的 stdin/stdout NDJSON 协议行为，
> 不经过 Host HTTP 层，由各 adapter 包的 vitest 覆盖。

---

## A1. Sarsapa Agent Loop

| # | 场景 | 验证点 | Spec |
|---|------|--------|------|
| A1.1 | Tool call → execute → 返回结果 loop | 完整 ReAct 循环 | [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md) |
| A1.2 | Token usage 累积 | 多 turn 后 usage 正确累加 | [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md) |
| A1.3 | Wire tool call ID | callId 正确透传 | [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md) |
| A1.4 | Error resilience | API 报错时不崩溃，emit error frame | [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md) |

---

## A2. Claude Code Stream Parser

| # | 场景 | 验证点 | Spec |
|---|------|--------|------|
| A2.1 | Text-only assistant turn | 纯文本响应解析 | [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md) |
| A2.2 | Tool use + output backfill | tool_use → tool_result 解析 | [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md) |
| A2.3 | Result line token usage | `result` 行提取 token 统计 | [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md) |
| A2.4 | Error handling | 异常输出不崩溃 | [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md) |

---

## A3. Codex Stream Parser

| # | 场景 | 验证点 | Spec |
|---|------|--------|------|
| A3.1 | Init scaffold | 初始化 frame 正确发送 | [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md) |
| A3.2 | Agent message turn | 文本消息解析 | [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md) |
| A3.3 | Command execution tool call | shell 命令 → tool turn | [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md) |
| A3.4 | Token usage | usage 字段提取 | [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md) |

---

## A4. Hermes Adapter

| # | 场景 | 验证点 | Spec |
|---|------|--------|------|
| A4.1 | Progressive turns（流式 turn 输出） | 逐步 emit turn 而非结束时一次性 | [adapter/adapter-hermes-progressive-turns.md](./adapter/adapter-hermes-progressive-turns.md) |
| A4.2 | Turn token usage | 每个 turn 带 token 统计 | [adapter/adapter-hermes-turn-token-usage.md](./adapter/adapter-hermes-turn-token-usage.md) |

---

# CLI Command Reference

| Command Group | Subcommands |
|--------------|-------------|
| `sumeru server` | `start`, `stop`, `restart`, `status` |
| `sumeru adapter` | `list`, `get`, `models` |
| `sumeru provider` | `list`, `add`, `update`, `remove` |
| `sumeru model` | `list`, `add`, `update`, `remove` |
| `sumeru prototype` | `list`, `remove` |
| `sumeru persona` | `list`, `get`, `add`, `remove` |
| `sumeru session` | `list`, `add`, `send`, `turns`, `logs`, `stop`, `remove`, `exec`, `reset`, `snapshot`, `model` |
| ~~`sumeru search`~~ | *(已移除 [#256](https://git.shazhou.work/shazhou/sumeru/issues/256))* |

---

# 原则

1. 每个场景可独立跑（不依赖其他场景的 side effect）
2. Given/When/Then 格式
3. 基于实际 API（server.ts 路由表）+ CLI（main.ts 命令），不臆测
4. 场景编号稳定，新增在末尾追加
5. Spec 列为 `—` 表示尚未编写对应 spec 文件
6. CLI 列为 `—` 表示该场景不适用于 CLI（协议层 / 内部行为）
7. CLI 列为 `🚧 #N` 表示 API 已实现但 CLI 缺失，已开 issue 跟进
