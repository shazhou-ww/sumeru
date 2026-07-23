# Session 行为规范

> atest: [`session-lifecycle.test.yaml`](../atest/session-lifecycle.test.yaml),
> [`session-commands.test.yaml`](../atest/session-commands.test.yaml),
> [`error-paths.test.yaml`](../atest/error-paths.test.yaml),
> [`turns-pagination.test.yaml`](../atest/turns-pagination.test.yaml),
> [`resume-after-restart.test.yaml`](../atest/resume-after-restart.test.yaml),
> [`snapshot-inherit-sarsapa.test.yaml`](../atest/snapshot-inherit-sarsapa.test.yaml),
> [`snapshot-inherit-hermes.test.yaml`](../atest/snapshot-inherit-hermes.test.yaml)

Session 是 Agent 与用户交互的实例。每个 session 绑定一个 Prototype，运行在一个 Docker container 中。

## Session 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一 ID（`ses_` 前缀） |
| prototype | string | 引用的 Prototype 名称 |
| model | ModelConfig | 当前使用的模型配置 |
| image | string | Docker image 名称 |
| project | string \| null | 项目目录路径 |
| task | string \| null | 初始任务消息 |
| status | SessionStatus | `running` \| `idle` |
| exit | ExitSignal \| null | 退出信号 |
| tokenUsage | TokenUsage \| null | Token 使用统计 |
| createdAt | string | ISO 8601 创建时间 |

## 子命令总览

| CLI 子命令 | API | 说明 |
|-----------|-----|------|
| `sumeru session list` | `GET /sessions` | 列出所有 session |
| `sumeru session get <id>` | `GET /sessions/:id` | 获取 session 详情 |
| `sumeru session add <proto> [--task] [--project]` | `POST /sessions` | 创建 session |
| `sumeru session stop <id>` | `POST /sessions/:id/stop` | 停止运行中的 session |
| `sumeru session remove <id>` / `rm <id>` | `DELETE /sessions/:id` | 删除 session |
| `sumeru session send <id> <msg>` | `POST /sessions/:id/messages` | 向 session 发消息 |
| `sumeru session logs <id> [-w]` | `GET /sessions/:id/events` | 流式事件日志 |
| `sumeru session turns <id> [--after]` | `GET /sessions/:id/turns` | 查询对话历史 |
| `sumeru session exec <id> -- <cmd>` | `POST /sessions/:id/commands` (exec) | 容器内执行命令 |
| `sumeru session reset <id>` | `POST /sessions/:id/commands` (reset) | 清除上下文 |
| `sumeru session snapshot <id> <name>` | `POST /sessions/:id/commands` (snapshot) | 快照为新 prototype |

---

## list — 列出所有 session

```
$ sumeru session list
#  ID                              PROTOTYPE      STATUS   TASK
-  ------------------------------  -------------  -------  ---------
1  ses_01KY71ZC5...               atest-sarsapa  idle     say hello
```

**Then** 返回表格，按创建时间倒序。无 session 时显示 `(empty)`。

---

## get — 获取详情

```
$ sumeru session get ses_01KY71ZC5...
ID: ses_01KY71ZC5...
Prototype: atest-sarsapa
Status: idle
Task: say hello
```

**Error** `session_not_found` — session 不存在时输出错误。

---

## add — 创建 session

```
sumeru session add <prototype> [--task <msg>] [--project <path>] [--skip-reset] [--env KEY=VAL]
```

**When** prototype 存在

1. 从 Prototype 读取 persona / model / adapter / image
2. 解析 model（三态：省略用 prototype 默认、string 查 SQLite、object 直接用）
3. 启动 Docker container
4. 调 adapter `config` subcommand（注入 instructions + model + skills）
5. 调 adapter `reset` subcommand（`--skip-reset` 时跳过）
6. 投递 task 消息（`--task` 时）

**Output** `Created session ses_<id>`

**Error**
- `prototype_not_found` — prototype 不存在
- `image_not_found` — Docker image 不存在
- `model_not_found` / `provider_not_found` — model override 解析失败

### Model 解析三态

| 模式 | 输入 | 行为 |
|------|------|------|
| 省略 | 不传 `--model` | 用 prototype 的 model |
| Model ID | `--model copilot:claude-3` | 从 SQLite 查 Model → Provider → 组装 ModelConfig |
| Ad-hoc | `--model '{"provider":{...},"name":"..."}'` | 直接构建 ModelConfig |

---

## stop — 停止运行中的 session

```
$ sumeru session stop ses_...
stopped ses_...
```

**Error**
- `session_not_found` — session 不存在
- `session_already_idle` — session 已 idle（非 running）

---

## remove / rm — 删除 session

```
$ sumeru session rm ses_...
Removed session ses_...
```

**Behavior** 停止 container（如运行中）→ 删除 session 记录 → 释放资源。

**Error** `session_not_found` — session 不存在。

---

## send — 向 session 发消息

```
sumeru session send <id> "<message>" [--model <id>] [--env KEY=VAL]
```

**When** session 为 idle

1. 调 adapter `config` subcommand（如配置有变更）
2. 调 adapter `message` subcommand
3. 流式输出 turn 事件

**Output** `accepted message msg_<id> for ses_<id>`

**Error**
- `session_not_found` — session 不存在
- `session_busy` — session 正在运行（409）

---

## logs — 流式事件日志

```
sumeru session logs <id> [-w | --watch]
```

**Output** SSE 事件流：turn、heartbeat、exit 事件。`-w` 模式实时跟踪。

---

## turns — 查询对话历史

```
sumeru session turns <id> [--after <N>] [-w | --watch]
```

**Output** 格式化输出每条 turn：

```
[user] 2026-07-23T08:05:57.243Z
say hi

[assistant] 2026-07-23T08:06:00.905Z
Hi there! 👋
```

- `--after N` — 只返回 id > N 的 turn（游标分页）
- `-w` — watch 模式，实时跟踪新 turn

**Error**
- `session_not_found` — session 不存在
- `Invalid number for --after: abc` — after 参数非数字

---

## exec — 容器内执行命令

```
sumeru session exec <id> -- <command...>
```

**Output** 命令 stdout。返回 container 的 exit code。

**Error** `session_not_found` / `adapter_unavailable`

---

## reset — 清除上下文

```
sumeru session reset <id> [--persona <name>]
```

**Behavior**
1. 调 adapter `reset` subcommand（删除 resetPaths 中的文件）
2. 如果指定 `--persona`，更新 persona 配置

**Output** `reset ses_<id>`

**已知问题** reset 后 send 可能不回复（adapter resume 读不到 initConfig，#281 已修 hermes，sarsapa 待修）。

---

## snapshot — 快照为新 prototype

```
sumeru session snapshot <id> <name>
```

**Behavior**
1. `docker commit` 当前 container 为新 image `sumeru/<name>:dev`
2. 注册新 prototype（name → image mapping）

**Output**
```
Snapshot created
  Name:  <name>
  Image: sumeru/<name>:dev
```

---

## Session 生命周期状态机

```
                 add (--task)
                    │
    ┌───────────────▼──────────────┐
    │         running              │
    │  (adapter processing task)   │
    └───────────────┬──────────────┘
                    │ task completed
                    ▼
    ┌──────────────────────────────┐
    │           idle               │◄──── send (new message)
    │  (waiting for next message)  │      │
    └───────────────┬──────────────┘      │
                    │                     │
                    ▼                     ▼
               remove              running (cycle)
                    │
                    ▼
                 deleted
```

- `add --task` → running → task 完成 → idle
- `add`（无 task）→ idle
- `send` on idle → running → 完成 → idle
- `stop` on running → idle
- `remove` → 任何状态均可删除

---

## Host 重启后恢复

Host 重启时，session 的 container 状态（包括 adapter 持久化文件如 `session.json`、`state.db`）保留在 Docker image 层中。Host 重启后重新加载 session 记录，adapter 通过 `resume()` 恢复上下文。

验证：创建 session → 注入 secret → server restart → send → assistant 仍知道 secret。

---

## 响应信封

```json
{ "type": "@sumeru/session", "value": { ... } }
{ "type": "@sumeru/session-list", "value": [ ... ] }
```

错误响应：
```json
{ "type": "@sumeru/error", "value": { "code": "session_not_found", "message": "Session not found" } }
```
