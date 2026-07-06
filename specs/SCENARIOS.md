# Sumeru — Scenario 总纲

> 按功能域组织，每个场景同时列出 API 端点和对应 CLI 命令。
> CLI 标注说明：`—` = 不适用（by design），`🚧 #N` = 缺失已开 issue 跟进。

---

# Part I — Host 本体（API + CLI E2E）

---

## 1. Host 状态

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 1.1 | 查询 Host 状态 | `GET /` | `sumeru server status` | [host/root-status/spec.md](./host/root-status/spec.md) |
| 1.2 | 启动 Host 进程 | — | `sumeru server start` | [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md) |
| 1.3 | 停止 Host 进程 | — | `sumeru server stop` | [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md) |

---

## 2. Session 生命周期

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 2.1 | 创建 session（happy path） | `POST /sessions` | `sumeru session add <proto> --project <p> --task <t>` | [session/create-and-start/spec.md](./session/create-and-start/spec.md) |
| 2.2 | 创建 session（project=null） | `POST /sessions` (`"project":null`) | `sumeru session add <proto> --project null --task <t>` | [session/create-and-start/spec.md](./session/create-and-start/spec.md) |
| 2.3 | 创建 session（prototype 不存在） | `POST /sessions` → 404 | `sumeru session add ghost ...` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 2.4 | 创建 session（project 路径越界） | `POST /sessions` → 400 | — (CLI 不直传越界路径) | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 2.5 | 列出所有 sessions | `GET /sessions` | `sumeru session list` | [session/list-and-detail/spec.md](./session/list-and-detail/spec.md) |
| 2.6 | 获取 session 详情 | `GET /sessions/:id` | `sumeru session get <id>` | [session/list-and-detail/spec.md](./session/list-and-detail/spec.md) |
| 2.7 | 停止 running session | `POST /sessions/:id/stop` | `sumeru session stop <id>` | [session/stop-running-session/spec.md](./session/stop-running-session/spec.md) |
| 2.8 | 停止已 idle session（409） | `POST /sessions/:id/stop` → 409 | `sumeru session stop <id>` → error | [session/stop-running-session/spec.md](./session/stop-running-session/spec.md) |
| 2.9 | 删除 idle session | `DELETE /sessions/:id` | `sumeru session remove <id>` | [session/delete-session/spec.md](./session/delete-session/spec.md) |
| 2.10 | 删除 running session | `DELETE /sessions/:id` | `sumeru session remove <id>` | [session/delete-session/spec.md](./session/delete-session/spec.md) |
| 2.11 | 并发排队（FIFO） | `POST /sessions`（满额时阻塞） | — (Host 内部调度，非用户可控操作) | [session/concurrency-fifo-queue/spec.md](./session/concurrency-fifo-queue/spec.md) |

---

## 3. Session 多轮恢复

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 3.1 | 向 idle session 发消息恢复执行 | `POST /sessions/:id/messages` | `sumeru session send <id> "msg"` | [resume/message-resume-idle.md](./resume/message-resume-idle.md) |
| 3.2 | 向 running session 发消息（409） | `POST /sessions/:id/messages` → 409 | `sumeru session send <id> "msg"` → error | [resume/message-resume-idle.md](./resume/message-resume-idle.md) |
| 3.3 | 发消息时切换 Model（hot-switch） | `POST /sessions/:id/messages` + `"model":"..."` | 🚧 [#246](https://git.shazhou.work/shazhou/sumeru/issues/246) `--model` flag 缺失 | [resume/model-hot-switch.md](./resume/model-hot-switch.md) |
| 3.4 | 发消息时注入环境变量 | `POST /sessions/:id/messages` + `"env":{...}` | 🚧 [#246](https://git.shazhou.work/shazhou/sumeru/issues/246) `--env` flag 缺失 | [resume/env-hot-injection.md](./resume/env-hot-injection.md) |

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
| 5.1 | 全量查询 turns | `GET /sessions/:id/turns` | 🚧 [#245](https://git.shazhou.work/shazhou/sumeru/issues/245) `session turns` 命令缺失 | [turns/list-turns-pagination/spec.md](./turns/list-turns-pagination/spec.md) |
| 5.2 | 分页查询（after=N） | `GET /sessions/:id/turns?after=N` | 🚧 [#245](https://git.shazhou.work/shazhou/sumeru/issues/245) `session turns --after N` 缺失 | [turns/list-turns-pagination/spec.md](./turns/list-turns-pagination/spec.md) |
| 5.3 | Turn discriminated union | turn 结构区分 assistant / tool | — (数据结构定义，非独立操作) | [turns/turn-discriminated-union/spec.md](./turns/turn-discriminated-union/spec.md) |

---

## 6. Registry — Provider

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 6.1 | 列出 providers | `GET /providers` | `sumeru provider list` | [provider/crud-lifecycle/spec.md](./provider/crud-lifecycle/spec.md) |
| 6.2 | 获取 provider 详情 | `GET /providers/:name` | `sumeru provider get <name>` | [provider/crud-lifecycle/spec.md](./provider/crud-lifecycle/spec.md) |
| 6.3 | 创建 provider | `PUT /providers/:name` | `sumeru provider add <name> --api-type --base-url` | [provider/crud-lifecycle/spec.md](./provider/crud-lifecycle/spec.md) |
| 6.4 | 更新 provider | `PUT /providers/:name` | `sumeru provider update <name> --api-type/--base-url/--api-key` | [provider/crud-lifecycle/spec.md](./provider/crud-lifecycle/spec.md) |
| 6.5 | 删除 provider | `DELETE /providers/:name` | `sumeru provider remove <name>` | [provider/crud-lifecycle/spec.md](./provider/crud-lifecycle/spec.md) |
| 6.6 | 删除被 Model 引用的 provider（409） | `DELETE /providers/:name` → 409 | `sumeru provider remove <name>` → error | [provider/crud-lifecycle/spec.md](./provider/crud-lifecycle/spec.md) |

---

## 7. Registry — Model

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 7.1 | 列出 models | `GET /models` 或 `GET /providers/:name/models` | `sumeru model list [--provider <name>]` | [model/crud-lifecycle/spec.md](./model/crud-lifecycle/spec.md) |
| 7.2 | 获取 model 详情 | `GET /providers/:name/models/:modelName` | `sumeru model get <provider:name>` | [model/crud-lifecycle/spec.md](./model/crud-lifecycle/spec.md) |
| 7.3 | 创建 model | `PUT /providers/:name/models/:modelName` | `sumeru model add <provider:name> --model <api-model>` | [model/crud-lifecycle/spec.md](./model/crud-lifecycle/spec.md) |
| 7.4 | 更新 model | `PUT /providers/:name/models/:modelName` | `sumeru model update <provider:name> --model/--context-window` | [model/crud-lifecycle/spec.md](./model/crud-lifecycle/spec.md) |
| 7.5 | 删除 model | `DELETE /providers/:name/models/:modelName` | `sumeru model remove <provider:name>` | [model/crud-lifecycle/spec.md](./model/crud-lifecycle/spec.md) |

---

## 8. Registry — Persona

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 8.1 | 列出 personas | `GET /personas` | `sumeru persona list` | [persona/crud-lifecycle/spec.md](./persona/crud-lifecycle/spec.md) |
| 8.2 | 获取 persona 详情 | `GET /personas/:name` | `sumeru persona get <name>` | [persona/crud-lifecycle/spec.md](./persona/crud-lifecycle/spec.md) |
| 8.3 | 创建 persona | `PUT /personas/:name` | `sumeru persona add <name> --instructions --skills` | [persona/crud-lifecycle/spec.md](./persona/crud-lifecycle/spec.md) |
| 8.4 | 更新 persona | `PUT /personas/:name` | `sumeru persona update <name> --instructions/--skills` | [persona/crud-lifecycle/spec.md](./persona/crud-lifecycle/spec.md) |
| 8.5 | 删除 persona | `DELETE /personas/:name` | `sumeru persona remove <name>` | [persona/crud-lifecycle/spec.md](./persona/crud-lifecycle/spec.md) |
| 8.6 | 删除被 Prototype 引用的 persona（409） | `DELETE /personas/:name` → 409 | `sumeru persona remove <name>` → error | [persona/crud-lifecycle/spec.md](./persona/crud-lifecycle/spec.md) |

---

## 9. Registry — Skill

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 9.1 | 获取 skill | `GET /skills/:name` | `sumeru skill get <name>` | [skill/crud-idempotent/spec.md](./skill/crud-idempotent/spec.md) |
| 9.2 | 创建/更新 skill（PUT 幂等） | `PUT /skills/:name` | `sumeru skill put <name> --content <text>` | [skill/crud-idempotent/spec.md](./skill/crud-idempotent/spec.md) |
| 9.3 | 删除 skill（无引用） | `DELETE /skills/:name` | `sumeru skill remove <name>` | [skill/delete-reverse-reference/spec.md](./skill/delete-reverse-reference/spec.md) |
| 9.4 | 删除被 Prototype 引用的 skill（409） | `DELETE /skills/:name` → 409 | `sumeru skill remove <name>` → error | [skill/delete-reverse-reference/spec.md](./skill/delete-reverse-reference/spec.md) |

---

## 10. Registry — Prototype

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 10.1 | 列出 prototypes | `GET /prototypes` | `sumeru prototype list` | [prototype/crud-lifecycle/spec.md](./prototype/crud-lifecycle/spec.md) |
| 10.2 | 获取 prototype 详情 | `GET /prototypes/:name` | `sumeru prototype get <name>` | [prototype/crud-lifecycle/spec.md](./prototype/crud-lifecycle/spec.md) |
| 10.3 | 创建 prototype | `PUT /prototypes/:name` | `sumeru prototype add <name> --model --adapter [--persona]` | [prototype/crud-lifecycle/spec.md](./prototype/crud-lifecycle/spec.md) |
| 10.4 | 更新 prototype | `PUT /prototypes/:name` | `sumeru prototype update <name> --model/--adapter/--persona` | [prototype/crud-lifecycle/spec.md](./prototype/crud-lifecycle/spec.md) |
| 10.5 | 删除 prototype | `DELETE /prototypes/:name` | `sumeru prototype remove <name>` | [prototype/crud-lifecycle/spec.md](./prototype/crud-lifecycle/spec.md) |

---

## 11. Registry — Extension

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 11.1 | 列出 extensions | `GET /extensions` | `sumeru extension list` | [extension/crud-lifecycle/spec.md](./extension/crud-lifecycle/spec.md) |
| 11.2 | 获取 extension 详情 | `GET /extensions/:name` | `sumeru extension get <name>` | [extension/crud-lifecycle/spec.md](./extension/crud-lifecycle/spec.md) |
| 11.3 | 创建/更新 extension | `PUT /extensions/:name` | `sumeru extension put <name> --dockerfile <instr>` | [extension/crud-lifecycle/spec.md](./extension/crud-lifecycle/spec.md) |
| 11.4 | 删除 extension | `DELETE /extensions/:name` | `sumeru extension remove <name>` | [extension/crud-lifecycle/spec.md](./extension/crud-lifecycle/spec.md) |

---

## 12. Adapter — 可观测面

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 12.1 | 列出 adapters | `GET /adapters` | `sumeru adapter list` | [adapter/adapter-list/spec.md](./adapter/adapter-list/spec.md) |
| 12.2 | 获取 adapter 详情 | `GET /adapters/:name` | `sumeru adapter get <name>` | [adapter/adapter-list/spec.md](./adapter/adapter-list/spec.md) |
| 12.3 | 列出 adapter 内置模型 | `GET /adapters/:name/models` | `sumeru adapter models <name>` | [adapter/adapter-list/spec.md](./adapter/adapter-list/spec.md) |

---

## 13. In-Session Commands

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 13.1 | model 命令（切换 model） | `POST /sessions/:id/commands` `{"command":"model",...}` | `sumeru session model <id> <model-id>` | [commands/session-commands/spec.md](./commands/session-commands/spec.md) |
| 13.2 | reset 命令（清上下文） | `POST /sessions/:id/commands` `{"command":"reset",...}` | `sumeru reset <id>` | [commands/session-commands/spec.md](./commands/session-commands/spec.md) |
| 13.3 | install-skill 命令 | `POST /sessions/:id/commands` `{"command":"install-skill",...}` | — (API-only，CLI 无独立入口) | [commands/session-commands/spec.md](./commands/session-commands/spec.md) |
| 13.4 | snapshot 命令（docker commit） | `POST /sessions/:id/commands` `{"command":"snapshot",...}` | `sumeru snapshot <id>` | [commands/session-commands/spec.md](./commands/session-commands/spec.md) |

---

## ~~14. Image 构建~~ (已废弃，见 [#247](https://git.shazhou.work/shazhou/sumeru/issues/247))

---

## 15. Search

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 15.1 | 全文搜索 sessions | `GET /search?q=...` | `sumeru search <query> [--session <id>]` | [search/full-text-search/spec.md](./search/full-text-search/spec.md) |

---

## 16. 交互模式

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 16.1 | 交互式对话 | — (CLI-only) | `sumeru chat <prototype> --project <p>` | — |
| 16.2 | 单次执行 | — (CLI-only) | `sumeru exec <prototype> --project <p> --task <t>` | — |

---

## 17. Setup

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 17.1 | 初始化环境 | — (CLI-only) | `sumeru setup --provider --api-key --model` | — |

---

## 18. 错误契约

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 18.1 | 400 Invalid JSON | 所有 POST/PUT 端点 | 所有写命令 → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.2 | 400 Missing fields | `POST /sessions` 缺必填 | `sumeru session add` 缺参数 → help 提示 | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.3 | 400 Invalid project | `POST /sessions` 路径越界 | — (路径校验在 Host 侧) | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.4 | 404 Session not found | `GET/POST/DELETE /sessions/:id` | `sumeru session get/stop/remove <id>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.5 | 404 Prototype not found | `POST /sessions`, `GET /prototypes/:name` | `sumeru session add`, `sumeru prototype get` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.6 | 404 Skill not found | `GET /skills/:name` | `sumeru skill get <name>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.7 | 409 Session already idle | `POST /sessions/:id/stop` | `sumeru session stop <id>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.8 | 409 Skill referenced | `DELETE /skills/:name` | `sumeru skill remove <name>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.9 | 409 Provider in use | `DELETE /providers/:name` | `sumeru provider remove <name>` → error | [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md) |
| 18.10 | Host 未启动时操作 | `ECONNREFUSED` | 所有命令 → 友好错误提示 | [cli/error-experience/spec.md](./cli/error-experience/spec.md) |

---

## 19. Host 韧性

| # | 场景 | API | CLI | Spec |
|---|------|-----|-----|------|
| 19.1 | unhandledRejection 守卫 | — (进程级) | — (内部行为) | [host/unhandled-rejection-guard.md](./host/unhandled-rejection-guard.md) |
| 19.2 | markIdle 缺失 session 守卫 | — (内部) | — (内部行为) | [host/mark-idle-missing-session-guard.md](./host/mark-idle-missing-session-guard.md) |
| 19.3 | Adapter 异常退出后 Host 存活 | — (端到端不变量) | — (内部行为) | [host/adapter-abnormal-exit-resilience.md](./host/adapter-abnormal-exit-resilience.md) |

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

# 原则

1. 每个场景可独立跑（不依赖其他场景的 side effect）
2. Given/When/Then 格式
3. 基于实际 API（server.ts 路由表）+ CLI（main.ts 命令），不臆测
4. 场景编号稳定，新增在末尾追加
5. Spec 列为 `—` 表示尚未编写对应 spec 文件
6. CLI 列为 `—` 表示该场景不适用于 CLI（协议层 / 内部行为）
7. CLI 列为 `🚧 #N` 表示 API 已实现但 CLI 缺失，已开 issue 跟进
