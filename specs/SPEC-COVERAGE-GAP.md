# Spec 测试覆盖缺口跟踪

> 根据 specs/SCENARIOS.md 分析，记录所有缺少 atest/vitest 覆盖的场景。
> 最后更新：2026-07-24

## 状态说明
- [ ] 待补充
- [ ] 被阻塞（需要其他 issue 先完成）
- [x] 已完成

---

## 🔴 被阻塞的场景

### Section 3 - Session 多轮恢复

- [ ] **3.3** - 发消息时切换 Model（hot-switch）
  - API: `POST /sessions/:id/messages` + `"model":"..."`
  - CLI: `sumeru session send <id> --model <model>`
  - 阻塞原因: 🚧 [#246](https://git.shazhou.work/shazhou/sumeru/issues/246) `--model` flag 缺失
  - Spec: [resume/model-hot-switch.md](./resume/model-hot-switch.md)

- [ ] **3.4** - 发消息时注入环境变量
  - API: `POST /sessions/:id/messages` + `"env":{...}`
  - CLI: `sumeru session send <id> --env KEY=VALUE`
  - 阻塞原因: 🚧 [#246](https://git.shazhou.work/shazhou/sumeru/issues/246) `--env` flag 缺失
  - Spec: 待补

---

## 🟡 高优先级（快速补充）

### Section 8 - Registry — Persona

- [x] **8.5** - 删除被 Prototype 引用的 persona（409）
  - API: `DELETE /personas/:name` → 409
  - CLI: `sumeru persona remove <name>` → error
  - Spec: 待补
  - atest: `specs/atest/persona-prototype-reference-409.test.yaml` ✅
  - 难度: 低

### Section 10 - Adapter — 可观测面

- [x] **10.3** - 列出 adapter 内置模型
  - API: `GET /adapters/:name/models`
  - CLI: `sumeru adapter models <name>`
  - Spec: 待补
  - atest: `specs/atest/adapter-models-list.test.yaml` ✅
  - 难度: 低

### Section 1 - Host 状态

- [x] **1.1** - 查询 Host 状态
  - API: `GET /`
  - CLI: `sumeru server status`
  - Spec: [host/root-status/spec.md](./host/root-status/spec.md)
  - atest: `specs/atest/server-status.test.yaml` ✅
  - 难度: 低

- [ ] **1.2** - 启动 Host 进程
  - CLI: `sumeru server start`
  - Spec: [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md)
  - 难度: 中（需要控制 host 生命周期）

- [ ] **1.3** - 停止 Host 进程
  - CLI: `sumeru server stop`
  - Spec: [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md)
  - 难度: 中

- [ ] **1.4** - 重启 Host 进程
  - CLI: `sumeru server restart`
  - Spec: [cli/server-lifecycle/spec.md](./cli/server-lifecycle/spec.md)
  - 难度: 中

---

## 🟠 中优先级（需要设计）

### Section 2 - Session 生命周期

- [ ] **2.1** - Session 列表分页
  - API: `GET /sessions?limit=<n>&offset=<n>`
  - CLI: `sumeru session list [--limit n] [--offset n]`
  - Spec: [session/session-list-pagination/spec.md](./session/session-list-pagination/spec.md)
  - 难度: 中

- [ ] **2.2** - 按 ID 获取 Session
  - API: `GET /sessions/:id`
  - CLI: `sumeru session get <id>`
  - Spec: [session/session-get-by-id/spec.md](./session/session-get-by-id/spec.md)
  - 难度: 低

- [x] **2.3** - 创建 session（prototype 不存在）
  - API: `POST /sessions` → 404
  - CLI: `sumeru session add ghost` → error
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/error-paths.test.yaml` ✅ (line 20)
  - 难度: 低

- [x] **2.4** - 创建 session（project 路径越界）
  - API: `POST /sessions` → 400
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/invalid-project-path-400.test.yaml` ✅
  - 难度: 低

### Section 4 - SSE 事件流

- [ ] **4.1** - 订阅 session 事件流
  - API: `GET /sessions/:id/events`
  - CLI: `sumeru session logs <id> --follow`
  - Spec: [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md)
  - 难度: 高（SSE 流式测试）

- [ ] **4.2** - Turn 事件（assistant turn）
  - API: `event: turn`
  - CLI: `sumeru session logs <id>` 输出
  - Spec: [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md)
  - 难度: 高

- [ ] **4.3** - Exit 事件（关闭流）
  - API: `event: exit`
  - CLI: `sumeru session logs <id>` 输出
  - Spec: [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md)
  - 难度: 高

- [ ] **4.4** - Heartbeat 事件
  - API: `event: heartbeat`
  - Spec: [sse/turn-exit-heartbeat/spec.md](./sse/turn-exit-heartbeat/spec.md)
  - 难度: 高

- [ ] **4.5** - Last-Event-ID 断线重连
  - API: `GET /sessions/:id/events` + `Last-Event-ID` header
  - Spec: [sse/last-event-id-resume/spec.md](./sse/last-event-id-resume/spec.md)
  - 难度: 高

- [ ] **4.6** - Turn tokenUsage 字段
  - API: turn 事件内 `tokenUsage`
  - Spec: [sse/turn-event-token-usage/spec.md](./sse/turn-event-token-usage/spec.md)
  - 难度: 中

- [ ] **4.7** - Turn durationMs 字段
  - API: turn 事件内 `durationMs`
  - Spec: [sse/turn-event-duration-ms/spec.md](./sse/turn-event-duration-ms/spec.md)
  - 难度: 中

### Section 5 - Turns 查询

- [x] **5.3** - Turn discriminated union
  - API: turn 结构区分 assistant / tool
  - Spec: [turns/turn-discriminated-union/spec.md](./turns/turn-discriminated-union/spec.md)
  - atest: `specs/atest/turn-discriminated-union.test.yaml` ✅
  - 难度: 低（数据结构验证）

- [ ] **5.4** - 时间过滤（before=ISO）
  - API: `GET /sessions/:id/turns?before=<ISO>`
  - Spec: [session/turns-watch/spec.md](./session/turns-watch/spec.md)
  - 难度: 中

- [ ] **5.5** - Watch 实时监视
  - API: `GET /sessions/:id/turns/watch` (SSE)
  - CLI: `sumeru session turns <id> -w`
  - Spec: [session/turns-watch/spec.md](./session/turns-watch/spec.md)
  - 难度: 高（SSE 流式测试）

- [ ] **5.6** - Watch 输出格式一致性
  - CLI: `turns` 与 `turns -w` 格式一致
  - Spec: [session/turns-watch/tc-format-consistency.md](./session/turns-watch/tc-format-consistency.md)
  - 难度: 中

- [x] **5.7** - Turns 显示 tool calls
  - CLI: assistant turn 带 tool call 时显示 `→ name(args)`
  - Spec: [session/turns-watch/tc-format-consistency.md](./session/turns-watch/tc-format-consistency.md)
  - atest: `specs/atest/turns-show-tool-calls.test.yaml` ✅
  - 难度: 中

### Section 13 - 错误契约

- [x] **13.1** - 400 Invalid JSON
  - API: 所有 POST/PUT 端点
  - CLI: 所有写命令 → error
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/invalid-json-400.test.yaml` ✅
  - 难度: 低

- [x] **13.2** - 400 Missing fields
  - API: `POST /sessions` 缺必填
  - CLI: `sumeru session add` 缺参数 → help 提示
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/error-paths.test.yaml` ✅ (line 69)
  - 难度: 低

- [x] **13.3** - 400 Invalid project
  - API: `POST /sessions` 路径越界
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/invalid-project-path-400.test.yaml` ✅
  - 难度: 低

- [x] **13.4** - 404 Session not found
  - API: `GET/POST/DELETE /sessions/:id`
  - CLI: `sumeru session get/stop/remove <id>` → error
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/error-paths.test.yaml` ✅ (lines 52, 57, 62)
  - 难度: 低

- [x] **13.5** - 404 Prototype not found
  - API: `POST /sessions`, `GET /prototypes/:name`
  - CLI: `sumeru session add`, `sumeru prototype get` → error
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/error-paths.test.yaml` ✅ (line 20, same as 2.3)
  - 难度: 低

- [x] **13.6** - 409 Session already idle
  - API: `POST /sessions/:id/stop`
  - CLI: `sumeru session stop <id>` → error
  - Spec: [errors/standard-http-errors/spec.md](./errors/standard-http-errors/spec.md)
  - atest: `specs/atest/error-paths.test.yaml` ✅ (line 35, same as 2.8)
  - 难度: 低

- [ ] **13.7** - 409 Provider in use
  - API: `DELETE /providers/:name`
  - CLI: `sumeru provider remove <name>` → error
  - Spec: 待补
  - atest: `specs/atest/provider-in-use-409.test.yaml` ✅
  - 难度: 低

- [ ] **13.8** - Host 未启动时操作
  - CLI: 所有命令 → 友好错误提示
  - Spec: [cli/error-experience/spec.md](./cli/error-experience/spec.md)
  - 难度: 中

---

## 🔵 低优先级（复杂场景）

### Section 2 - Session 生命周期

- [ ] **2.11** - 并发排队（FIFO）
  - API: `POST /sessions`（满额时阻塞）
  - Spec: [session/concurrency-fifo-queue/spec.md](./session/concurrency-fifo-queue/spec.md)
  - 难度: 高（并发测试）

### Part II - Adapter 协议（vitest 覆盖）

#### A1. Sarsapa Agent Loop

- [ ] **A1.1** - Tool call → execute → 返回结果 loop
  - 验证点: 完整 ReAct 循环
  - Spec: [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md)
  - 难度: 中

- [ ] **A1.2** - Token usage 累积
  - 验证点: 多 turn 后 usage 正确累加
  - Spec: [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md)
  - 难度: 中

- [x] **A1.3** - Wire tool call ID
  - 验证点: callId 正确透传
  - Spec: [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md)
  - atest: `specs/atest/sarsapa-wire-tool-call-id.test.yaml` ✅
  - 难度: 低

- [ ] **A1.4** - Error resilience
  - 验证点: API 报错时不崩溃，emit error frame
  - Spec: [adapter/adapter-sarsapa-agent-loop/spec.md](./adapter/adapter-sarsapa-agent-loop/spec.md)
  - 难度: 中

#### A2. Claude Code Stream Parser

- [x] **A2.1** - Text-only assistant turn
  - 验证点: 纯文本响应解析
  - Spec: [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md)
  - atest: `specs/atest/sarsapa-text-only-turn.test.yaml` ✅
  - 难度: 低

- [ ] **A2.2** - Tool use + output backfill
  - 验证点: tool_use → tool_result 解析
  - Spec: [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md)
  - 难度: 中

- [x] **A2.3** - Result line token usage
  - 验证点: `result` 行提取 token 统计
  - Spec: [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md)
  - atest: `specs/atest/sarsapa-token-usage.test.yaml` ✅
  - 难度: 低

- [ ] **A2.4** - Error handling
  - 验证点: 异常输出不崩溃
  - Spec: [adapter/adapter-claude-code-stream-parser/spec.md](./adapter/adapter-claude-code-stream-parser/spec.md)
  - 难度: 中

#### A3. Codex Stream Parser

- [ ] **A3.1** - Init scaffold
  - 验证点: 初始化 frame 正确发送
  - Spec: [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md)
  - 难度: 低

- [ ] **A3.2** - Agent message turn
  - 验证点: 文本消息解析
  - Spec: [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md)
  - 难度: 低

- [ ] **A3.3** - Command execution tool call
  - 验证点: shell 命令 → tool turn
  - Spec: [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md)
  - 难度: 中

- [ ] **A3.4** - Token usage
  - 验证点: usage 字段提取
  - Spec: [adapter/adapter-codex-stream-parser/spec.md](./adapter/adapter-codex-stream-parser/spec.md)
  - 难度: 低

---

## 统计

- **总计**: 47 个场景
- **待补充**: 31 个
- **被阻塞**: 2 个
- **已完成**: 16 个

### 已完成清单
- ✅ 1.1 - 查询 Host 状态 (server-status.test.yaml)
- ✅ 2.3 - 创建 session（prototype 不存在）(error-paths.test.yaml)
- ✅ 2.4 - 创建 session（project 路径越界）(invalid-project-path-400.test.yaml)
- ✅ 5.3 - Turn discriminated union (turn-discriminated-union.test.yaml)
- ✅ 5.7 - Turns 显示 tool calls (turns-show-tool-calls.test.yaml)
- ✅ 8.5 - 删除被 Prototype 引用的 persona（409）(persona-prototype-reference-409.test.yaml)
- ✅ 10.3 - 列出 adapter 内置模型 (adapter-models-list.test.yaml)
- ✅ 13.1 - 400 Invalid JSON (invalid-json-400.test.yaml)
- ✅ 13.2 - 400 Missing fields (error-paths.test.yaml)
- ✅ 13.3 - 400 Invalid project (invalid-project-path-400.test.yaml)
- ✅ 13.4 - 404 Session not found (error-paths.test.yaml)
- ✅ 13.5 - 404 Prototype not found (error-paths.test.yaml)
- ✅ 13.6 - 409 Session already idle (error-paths.test.yaml)
- ✅ 13.7 - 409 Provider in use (provider-in-use-409.test.yaml)
- ✅ A1.3 - Wire tool call ID (sarsapa-wire-tool-call-id.test.yaml)
- ✅ A2.1 - Text-only assistant turn (sarsapa-text-only-turn.test.yaml)
- ✅ A2.3 - Result line token usage (sarsapa-token-usage.test.yaml)

### 按优先级分布
- 🔴 被阻塞: 2 个
- 🟡 高优先级: 3 个 (1.2, 1.3, 1.4)
- 🟠 中优先级: 23 个
- 🔵 低优先级: 11 个

### 按难度分布
- 低: 15 个
- 中: 14 个
- 高: 10 个
- 未评估: 8 个

---

## 下一步计划

### 批次 2: 错误路径补充
- 13.1 - 400 Invalid JSON
- 13.4 - 404 Session not found (部分已在 error-paths.test.yaml)
- 13.5 - 404 Prototype not found (部分已在 error-paths.test.yaml)
- 13.6 - 409 Session already idle (部分已在 error-paths.test.yaml)

### 批次 3: Turns 数据结构
- 5.3 - Turn discriminated union
- 5.7 - Turns 显示 tool calls

### 批次 4: Adapter 协议基础
- A1.3 - Wire tool call ID
- A2.1 - Text-only assistant turn
- A2.3 - Result line token usage
- A3.1 - Init scaffold
- A3.2 - Agent message turn
- A3.4 - Token usage
