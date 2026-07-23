# atest Test Case Checklist

> Sumeru E2E 测试用 atest 覆盖的 test case 规划。
> 设计原则：**所有场景都用 atest**，每步选合适的 judge 类型：
> - `judge: { type: llm }` — 不确定输出，语义判定
> - `judge: { type: regex | jsonata }` — 确定输出，精确匹配
> - 无 `judge`（transition）— exit code 0=PASS，非0=FAIL
>
> 前提：`.sumeru/.env` 不含 OPENAI/ANTHROPIC env（避免 hermes 401）。
> Adapter 覆盖 sarsapa + hermes（纯本地 LLM，无需外部 API key）。
> 资源命名 `atest-` 前缀避免冲突。
> atest ≥ 0.2.0（judge 对象格式）。
>
> **复合原则：** 每个 case 是一条完整的用户操作链，而非单个 API 调用。
> SCENARIOS.md 编号标注在括号内，确保覆盖可追溯。

---

## 已完成

| # | 文件 | 覆盖 SCENARIOS | Judge | 状态 |
|---|------|---------------|-------|------|
| 1 | `session/snapshot-context-inherit/sarsapa-snapshot-inherit.yaml` | 2.1, 11.5, 11.4(reset) | llm+regex | ✅ 8/8 |
| 2 | `session/snapshot-context-inherit/hermes-snapshot-inherit.yaml` | 2.1, 11.5, 11.4(reset) | llm+regex | ✅ 8/8 |

---

## Session 全生命周期

| # | 文件 | 覆盖 SCENARIOS | 操作链 | Judge |
|---|------|---------------|--------|-------|
| 3 | `session/lifecycle/session-lifecycle.yaml` | 2.1, 2.2, 2.5, 2.6, 3.1, 2.9, 2.10 | add(+task) → turns → list 含 → get 详情 → send 追加 → turns → stop → rm → list 不含 | llm+regex |
| 4 | `session/lifecycle/session-create-no-task.yaml` | 2.2 | add（无 task）→ get status=idle → send → turns | llm+regex |
| 5 | `session/lifecycle/session-delete-running.yaml` | 2.10 | add → 立即 rm running session → 判定清理成功 | regex |

### 跨 adapter

#3 sarsapa 和 hermes 各跑一套（hermes 版覆盖 #277/#279 session/resume 回归）。

---

## Session 命令

| # | 文件 | 覆盖 SCENARIOS | 操作链 | Judge |
|---|------|---------------|--------|-------|
| 6 | `commands/session-commands.yaml` | 11.2, 11.3, 11.4, 11.5 | add → exec → model 切换 → reset → snapshot → turns | llm+regex |

---

## 错误路径

| # | 文件 | 覆盖 SCENARIOS | 操作链 | Judge |
|---|------|---------------|--------|-------|
| 7 | `errors/error-paths.yaml` | 2.3, 2.8, 3.2, 13.4 | add ghost → 404 → add 正常 → stop idle → 409 → send running → 409 → get/stop/rm ghost → 404 | regex |

---

## 基础设施 CRUD

| # | 文件 | 覆盖 SCENARIOS | 操作链 | Judge |
|---|------|---------------|--------|-------|
| 8 | `prototype/crud-lifecycle.yaml` | 9.1, 9.2 | add → list 含 → rm → list 不含 | regex |
| 9 | `provider/crud-lifecycle.yaml` | 6.1-6.6 | add → get → update → list → rm → get 404 → rm 被引用 409 | regex |
| 10 | `model/crud-lifecycle.yaml` | 7.1-7.5 | add → get → list → update → rm → get 404 | regex |
| 11 | `persona/crud-lifecycle.yaml` | 8.1-8.5 | add → get → list → rm → get 404 → rm 被引用 409 | regex |
| 12 | `adapter/adapter-list.yaml` | 10.1-10.3 | list → get sarsapa → models | regex |

---

## Turns 查询

| # | 文件 | 覆盖 SCENARIOS | 操作链 | Judge |
|---|------|---------------|--------|-------|
| 13 | `turns/turns-pagination.yaml` | 5.1, 5.2 | add + 2 条消息 → turns 全量 → turns --after 1 → 判定只返回后续 | regex |

> Turns list/watch 的基本验证已包含在 #3 session-lifecycle 的操作链中。

---

## Host 韧性

| # | 文件 | 覆盖 SCENARIOS | 操作链 | Judge |
|---|------|---------------|--------|-------|
| 14 | `session/resume-after-restart/resume-after-restart.yaml` | 14.4 | add + task → server restart → send → 判定上下文不丢 | llm |

---

## 统计

| 维度 | 数量 |
|------|------|
| 已完成 | 2 |
| 规划新增 | 12 |
| **总计** | **14** |
| LLM judge 步骤 | ~8（LLM 回复判定） |
| regex/jsonata judge 步骤 | ~30（确定输出判定） |
| transition 步骤 | ~15（setup/teardown/sleep） |
| 跨 adapter | #1/#2 已有 sarsapa+hermes；#3 可加 hermes 版 |

## SCENARIOS 覆盖矩阵

| SCENARIOS 编号 | 覆盖的 case # |
|---------------|--------------|
| 1.1-1.4 (host) | —（vitest 覆盖，纯内部行为） |
| 2.1-2.2 (create) | 1, 2, 3, 4 |
| 2.3 (prototype not found) | 7 |
| 2.5-2.6 (list/detail) | 3 |
| 2.7-2.8 (stop) | 3, 7 |
| 2.9-2.10 (delete) | 3, 5 |
| 3.1 (send resume) | 1, 2, 3 |
| 3.2 (send running 409) | 7 |
| 3.3-3.4 (hot-switch/env) | 6（model 部分）；env 待 CLI flag（#246） |
| 4.1-4.7 (SSE) | —（vitest 覆盖，协议层行为） |
| 5.1-5.2 (turns list/pagination) | 3, 13 |
| 5.5-5.7 (watch) | —（交互式，vitest 覆盖） |
| 6.1-6.6 (provider) | 9 |
| 7.1-7.5 (model) | 10 |
| 8.1-8.5 (persona) | 11 |
| 9.1-9.2 (prototype) | 8 |
| 10.1-10.3 (adapter) | 12 |
| 11.2-11.5 (commands) | 6 |
| 13.2-13.6 (errors) | 7 |
| 14.4 (restart restore) | 14 |
| 14.1-14.3 (host guards) | —（vitest 覆盖，进程级行为） |

> **不覆盖的 SCENARIOS（理由）：**
> - 1.1-1.4: `server status/start/stop` — 纯 CLI 内部行为，vitest 已覆盖
> - 4.1-4.7: SSE 事件流 — 协议层行为，vitest 已覆盖
> - 5.5-5.7: turns watch — 交互式 SSE，不适合 atest
> - 14.1-14.3: host 韧性守卫 — 进程级内部行为，非 CLI 可测
