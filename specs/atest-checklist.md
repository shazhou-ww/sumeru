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

---

## 已完成

| # | 文件 | 场景 | Judge | 状态 |
|---|------|------|-------|------|
| 1 | `session/snapshot-context-inherit/sarsapa-snapshot-inherit.yaml` | snapshot 继承/隔离 | LLM | ✅ 8/8 |
| 2 | `session/snapshot-context-inherit/hermes-snapshot-inherit.yaml` | snapshot 继承/隔离 + send | LLM | ✅ 8/8 |

---

## Phase 1 — Session 核心流程

| # | 文件 | 场景 (SCENARIOS) | 步骤概要 | Judge |
|---|------|-----------------|----------|-------|
| 3 | `session/create-and-start/create-hello-world.yaml` | 2.1 创建 session happy path | prototype add → session add + task → retry 等 turns → 判定有 assistant 回复 | LLM |
| 4 | `session/create-and-start/create-no-task.yaml` | 2.2 minimal, no task | prototype add → session add（无 task）→ session get status=idle → 判定 idle | expr |
| 5 | `session/create-and-start/create-prototype-not-found.yaml` | 2.3 prototype 不存在 | session add ghost → 判定 error 含 prototype_not_found | expr |
| 6 | `resume/message-resume-idle.yaml` | 3.1 向 idle session 发消息 | session add + task → retry 等 turns → send 追加消息 → retry 等 turns → 判定回复基于前文 | LLM |
| 7 | `resume/message-resume-idle-hermes.yaml` | 3.1 hermes 版 | 同上，hermes adapter（覆盖 #277/#279 回归） | LLM |
| 8 | `session/delete-session/delete-lifecycle.yaml` | 2.9 + 2.10 删除 session | session add → session rm → list 不含该 session；删 running session → 判定清理成功 | expr |

## Phase 2 — Session 命令

| # | 文件 | 场景 (SCENARIOS) | 步骤概要 | Judge |
|---|------|-----------------|----------|-------|
| 9 | `commands/session-exec.yaml` | 11.2 容器内执行 shell | session add → exec "echo hello" → 判定输出含 hello | expr |
| 10 | `commands/session-reset.yaml` | 11.4 清上下文 | session add + task（注入 secret）→ reset → send 问 secret → 判定不知道 | LLM |
| 11 | `commands/session-snapshot-output.yaml` | 11.5 + 11.6 snapshot 输出 | session add → snapshot → 判定输出含 Snapshot created + image 名 | expr |

## Phase 3 — Session 状态 & 韧性

| # | 文件 | 场景 (SCENARIOS) | 步骤概要 | Judge |
|---|------|-----------------|----------|-------|
| 12 | `session/stop-running-session/stop-lifecycle.yaml` | 2.7 + 2.8 stop | session add + task → stop（running 时）→ 判定成功；stop idle → 判定 error 409 | expr |
| 13 | `session/list-and-detail/list-detail.yaml` | 2.5 + 2.6 列表/详情 | session add → session list 含该 session → session get 详情匹配 | expr |
| 14 | `session/resume-after-restart/restart-restore.yaml` | 14.4 host 重启后恢复 | session add + task → server restart → send → 判定上下文不丢 | LLM |

## Phase 4 — Turns 查询

| # | 文件 | 场景 (SCENARIOS) | 步骤概要 | Judge |
|---|------|-----------------|----------|-------|
| 15 | `turns/list-turns-pagination/list-all.yaml` | 5.1 全量查询 | session add + task → retry 等 turns → turns → 判定有 user + assistant turn | expr |
| 16 | `turns/list-turns-pagination/pagination-after.yaml` | 5.2 分页 after=N | session add + 2 条消息 → turns --after 1 → 判定只返回第 2 条之后的 | expr |

## Phase 5 — 基础设施 CRUD

| # | 文件 | 场景 (SCENARIOS) | 步骤概要 | Judge |
|---|------|-----------------|----------|-------|
| 17 | `prototype/crud-lifecycle.yaml` | 9.1 + 9.2 prototype list/remove | prototype add → list 含该 prototype → rm → list 不含 | expr |
| 18 | `provider/crud-lifecycle.yaml` | 6.1-6.5 provider CRUD | provider add → get 匹配 → update → list → remove → get 404 | expr |
| 19 | `provider/crud-lifecycle/provider-in-use.yaml` | 6.6 删被引用的 provider | provider 被 model 引用 → remove → 判定 error 409 | expr |
| 20 | `model/crud-lifecycle.yaml` | 7.1-7.5 model CRUD | model add → get → list → remove → get 404 | expr |
| 21 | `persona/crud-lifecycle.yaml` | 8.1-8.5 persona CRUD | persona add → get → list → remove → get 404 | expr |
| 22 | `adapter/adapter-list/list-and-detail.yaml` | 10.1-10.3 adapter list/get/models | adapter list → get sarsapa → 判定 providerMode=custom-only | expr |

## Phase 6 — 错误路径

| # | 文件 | 场景 (SCENARIOS) | 步骤概要 | Judge |
|---|------|-----------------|----------|-------|
| 23 | `errors/session-not-found.yaml` | 13.4 404 session not found | session get/stop/remove ghost → 判定 error session_not_found | expr |
| 24 | `errors/missing-fields.yaml` | 13.2 400 missing fields | session add 缺参数 → 判定 help 提示或 error | expr |

---

## 跨 adapter 矩阵

Phase 1-2 中涉及 LLM 交互的 case，sarsapa 和 hermes 各跑一套：

| Case | sarsapa | hermes |
|------|---------|--------|
| #3 create-hello-world | `create-hello-world.yaml` | （同模板，adapter 参数换 hermes） |
| #6/#7 message-resume-idle | `message-resume-idle.yaml` | `message-resume-idle-hermes.yaml` |
| #10 session-reset | `session-reset.yaml` | （同模板，hermes 版，覆盖 #281 resetPaths 回归） |

注：CRUD/errors/turns 分页类 case adapter 无关（只涉及 host CLI），不需要跨 adapter。

---

## 依赖

- **Phase 5-6 的 expr judge** 依赖 atest 确定性 judge 功能（表达式匹配）
- 在该功能上线前，Phase 5-6 的 case 可以先用 `judge_prompt`（LLM）或 transition step（exit code）跑
- Phase 1-4 不依赖新功能，可立即开始

---

## 统计

- 已完成：2
- 规划新增：22
- 总计：24 个 atest spec
- LLM judge：8 个（不确定输出）
- expr judge：14 个（确定输出，待 atest 支持）
- transition only：2 个（CRUD 的部分 step）
