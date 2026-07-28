# Session 行为规范

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
| `sumeru session add` | POST /sessions | 创建 session |
| `sumeru session get` | GET /sessions/:id | 获取详情 |
| `sumeru session list` | GET /sessions | 列出所有 |
| `sumeru session send` | POST /sessions/:id/messages | 发送消息 |
| `sumeru session exec` | POST /sessions/:id/commands (exec) | 容器内执行命令 |
| `sumeru session reset` | POST /sessions/:id/commands (reset) | 重置上下文 |
| `sumeru session model` | POST /sessions/:id/commands (model) | 切换模型 |
| `sumeru session snapshot` | POST /sessions/:id/commands (snapshot) | 快照容器 |
| `sumeru session stop` | POST /sessions/:id/stop | 停止 |
| `sumeru session remove` | DELETE /sessions/:id | 删除 |
| `sumeru session turns` | GET /sessions/:id/turns | 查看对话轮次 |
| `sumeru session logs` | GET /sessions/:id/events | 查看事件日志 |

---

## add — 创建 session


12|
13|创建新 session。根据 prototype 找到 adapter 和 model，在 Docker 中启动容器。
14|
15|## 参数
16|
17|| 参数 | 类型 | 必填 | 默认值 | 说明 |
18||------|------|------|--------|------|
19|| `prototype` | string | 是 | — | Prototype 名称（位置参数） |
20|| `--task` | string | 否 | — | 初始任务消息 |
21|| `--project` | string | 否 | — | 项目目录路径 |
22|| `--skip-reset` | boolean | 否 | false | 跳过 reset 步骤（用于 snapshot 继承场景） |
23|| `--env` | string | 否 | — | 环境变量，格式 `KEY=VALUE`，可重复 |
24|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
25|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
26|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
27|
28|## 用例
29|
30|### 用例 1：正常创建（带 task）
31|
32|**前提条件**  
33|指定的 prototype 存在
34|
35|**命令**  
36|```bash
37|sumeru session add <prototype> --task "执行任务 X"
38|```
39|
40|**后置条件**  
41|- **text**: 输出 `Created session ses_XXX`
42|- **json**: `value.status = "queued"`
43|- **副作用**: Session 被创建，Docker 容器启动，状态为 running
44|
45|---
46|
47|### 用例 2：正常创建（无 task）
48|
49|**前提条件**  
50|指定的 prototype 存在
51|
52|**命令**  
53|```bash
54|sumeru session add <prototype>
55|```
56|
57|**后置条件**  
58|- **text**: 输出 `Created session ses_XXX`
59|- **json**: `value.status = "idle"`
60|- **副作用**: Session 被创建，Docker 容器启动，状态为 idle
61|
62|---
63|
64|### 用例 3：带 project
65|
66|**前提条件**  
67|指定的 prototype 存在，`--project` 路径合法
68|
69|**命令**  
70|```bash
71|sumeru session add <prototype> --project /path/to/project
72|```
73|
74|**后置条件**  
75|- **text**: 输出 `Created session ses_XXX`
76|- **json**: `value.project = "/path/to/project"`
77|- **副作用**: Session 被创建，容器内 `/workspace` 挂载到指定路径
78|
79|---
80|
81|### 用例 4：prototype 不存在
82|
83|**前提条件**  
84|指定的 prototype 不存在
85|
86|**命令**  
87|```bash
88|sumeru session add nonexistent-prototype
89|```
90|
91|**后置条件**  
92|- **text**: 输出包含 `prototype_not_found` 错误信息
93|- **json**: 返回错误对象 `{"code": "prototype_not_found", ...}`
94|- **副作用**: 无
95|- **退出码**: 非 0
96|
97|---
98|
99|### 用例 5：project 路径越界
100|
101|**前提条件**  
102|指定的 prototype 存在
103|
104|**命令**  
105|```bash
106|sumeru session add <prototype> --project /etc/passwd
107|```
108|
109|**后置条件**  
110|- **text**: 输出错误信息
111|- **json**: 返回错误对象
112|- **副作用**: 无
113|- **退出码**: 非 0
114|
115|---
116|
117|### 用例 6：--skip-reset
118|
119|**前提条件**  
120|指定的 prototype 存在，用于 snapshot 继承场景
121|
122|**命令**  
123|```bash
124|sumeru session add <prototype> --skip-reset
125|```
126|
127|**后置条件**  
128|- **text**: 输出 `Created session ses_XXX`
129|- **json**: 返回 session 对象
130|- **副作用**: Session 被创建，跳过 adapter reset 步骤
131|
---

## send — 发送消息


9|
10|向 session 发送消息，实现多轮对话。
11|
12|## 参数
13|
14|| 参数 | 类型 | 必填 | 默认值 | 说明 |
15||------|------|------|--------|------|
16|| `id` | string | 是 | — | Session ID（位置参数） |
17|| `message` | string | 是 | — | 消息内容（位置参数） |
18|| `--model` | string | 否 | — | 热切换模型 |
19|| `--env` | string | 否 | — | 环境变量，格式 `KEY=VALUE`，可重复 |
20|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
21|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
22|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
23|
24|## 用例
25|
26|### 用例 1：正常发送
27|
28|**前提条件**  
29|存在 ID 为 `ses_XXX` 的 session，状态为 idle
30|
31|**命令**  
32|```bash
33|sumeru session send ses_XXX "请执行任务 Y"
34|```
35|
36|**后置条件**  
37|- **text**: 输出包含 `accepted message msg_XXX` 确认信息
38|- **json**: 返回消息对象
39|- **副作用**: Session 状态从 idle 变为 running，产生新 turn
40|
41|---
42|
43|### 用例 2：session 不存在
44|
45|**前提条件**  
46|ID 为 `ses_FAKE` 的 session 不存在
47|
48|**命令**  
49|```bash
50|sumeru session send ses_FAKE "消息内容"
51|```
52|
53|**后置条件**  
54|- **text**: 输出包含 `session_not_found` 错误信息
55|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
56|- **副作用**: 无
57|- **退出码**: 非 0
58|
59|---
60|
61|### 用例 3：session running 时发送
62|
63|**前提条件**  
64|存在 ID 为 `ses_XXX` 的 session，状态为 running
65|
66|**命令**  
67|```bash
68|sumeru session send ses_XXX "追加消息"
69|```
70|
71|**后置条件**  
72|- **行为**: 取决于实现——FIFO 排队或拒绝（返回 `session_busy` 错误）
73|- **副作用**: 若排队则消息等待处理；若拒绝则无副作用
74|- **退出码**: 若拒绝则非 0
75|
---

## exec — 容器内执行


8|
9|在 session 的 Docker 容器内执行 shell 命令。
10|
11|## 参数
12|
13|| 参数 | 类型 | 必填 | 默认值 | 说明 |
14||------|------|------|--------|------|
15|| `id` | string | 是 | — | Session ID（位置参数） |
16|| `command...` | string | 是 | — | 要执行的命令（位置参数，`--` 后） |
17|
18|## 用例
19|
20|### 用例 1：正常执行
21|
22|**前提条件**  
23|存在 ID 为 `ses_XXX` 的 session，状态为 idle
24|
25|**命令**  
26|```bash
27|sumeru session exec ses_XXX -- ls -la
28|```
29|
30|**后置条件**  
31|- **输出**: 命令的 stdout
32|- **退出码**: 等于命令的 exit code
33|- **副作用**: 无
34|
35|---
36|
37|### 用例 2：session 不存在
38|
39|**前提条件**  
40|ID 为 `ses_FAKE` 的 session 不存在
41|
42|**命令**  
43|```bash
44|sumeru session exec ses_FAKE -- echo test
45|```
46|
47|**后置条件**  
48|- **text**: 输出包含 `session_not_found` 错误信息
49|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
50|- **副作用**: 无
51|- **退出码**: 非 0
52|
53|---
54|
55|### 用例 3：长时间命令
56|
57|**前提条件**  
58|存在 ID 为 `ses_XXX` 的 session
59|
60|**命令**  
61|```bash
62|sumeru session exec ses_XXX -- sleep 60
63|```
64|
65|**后置条件**  
66|- **行为**: 等待命令执行完成或超时
67|- **退出码**: 若超时则非 0
68|
---

## get — 获取详情


9|
10|获取指定 session 的详细信息。
11|
12|## 参数
13|
14|| 参数 | 类型 | 必填 | 默认值 | 说明 |
15||------|------|------|--------|------|
16|| `id` | string | 是 | — | Session ID（位置参数） |
17|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
18|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
19|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
20|
21|## 用例
22|
23|### 用例 1：存在的 session
24|
25|**前提条件**  
26|存在 ID 为 `ses_XXX` 的 session
27|
28|**命令**  
29|```bash
30|sumeru session get ses_XXX
31|```
32|
33|**后置条件**  
34|- **text**: 输出包含 ID、Prototype、Status、Task、Project 等字段
35|- **json**: 返回完整 session 对象，包含所有字段
36|- **副作用**: 无
37|
38|---
39|
40|### 用例 2：不存在的 session
41|
42|**前提条件**  
43|ID 为 `ses_FAKE` 的 session 不存在
44|
45|**命令**  
46|```bash
47|sumeru session get ses_FAKE
48|```
49|
50|**后置条件**  
51|- **text**: 输出包含 `session_not_found` 错误信息
52|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
53|- **副作用**: 无
54|- **退出码**: 非 0
55|
---

## list — 列出所有


9|
10|列出所有 session，按创建时间倒序排列。支持分页和多种输出格式。
11|
12|## 参数
13|
14|| 参数 | 类型 | 必填 | 默认值 | 说明 |
15||------|------|------|--------|------|
16|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
17|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
18|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
19|| `--limit` | number | 否 | 50 | 返回条数上限 |
20|| `--offset` | number | 否 | 0 | 跳过前 N 条 |
21|
22|## 用例
23|
24|### 用例 1：正常列出
25|
26|**前提条件**  
27|系统中存在若干 session
28|
29|**命令**  
30|```bash
31|sumeru session list
32|```
33|
34|**后置条件**  
35|- **text**: 输出表格，包含 ID、PROTOTYPE、STATUS、TASK 列
36|- **json**: 返回数组，每个元素为 session 对象
37|- **副作用**: 无
38|
39|---
40|
41|### 用例 2：空列表
42|
43|**前提条件**  
44|系统中无任何 session
45|
46|**命令**  
47|```bash
48|sumeru session list
49|```
50|
51|**后置条件**  
52|- **text**: 输出 `(empty)` 或类似提示
53|- **json**: 返回空数组 `[]`
54|- **副作用**: 无
55|
56|---
57|
58|### 用例 3：分页 limit
59|
60|**前提条件**  
61|系统中存在 3 个以上 session
62|
63|**命令**  
64|```bash
65|sumeru session list --limit 2
66|```
67|
68|**后置条件**  
69|- **text**: 表格最多显示 2 行数据
70|- **json**: 数组长度 ≤ 2
71|- **副作用**: 无
72|
73|---
74|
75|### 用例 4：分页 offset
76|
77|**前提条件**  
78|系统中存在 3 个以上 session
79|
80|**命令**  
81|```bash
82|sumeru session list --offset 2
83|```
84|
85|**后置条件**  
86|- **text**: 跳过前 2 条，从第 3 条开始显示
87|- **json**: 返回跳过前 2 条后的结果
88|- **副作用**: 无
89|
---

## remove — 删除


10|
11|删除 session 及其关联资源（Docker 容器等）。
12|
13|**别名**: `rm` 是 `remove` 的别名，两者功能完全相同。
14|
15|## 参数
16|
17|| 参数 | 类型 | 必填 | 默认值 | 说明 |
18||------|------|------|--------|------|
19|| `id` | string | 是 | — | Session ID（位置参数） |
20|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
21|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
22|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
23|
24|## 用例
25|
26|### 用例 1：正常删除（idle session）
27|
28|**前提条件**  
29|存在 ID 为 `ses_XXX` 的 session，状态为 idle
30|
31|**命令**  
32|```bash
33|sumeru session remove ses_XXX
34|# 或使用别名
35|sumeru session rm ses_XXX
36|```
37|
38|**后置条件**  
39|- **text**: 输出包含 `Removed` 确认信息
40|- **json**: 返回成功响应
41|- **副作用**: Session 从列表中消失，Docker 容器被移除
42|
43|---
44|
45|### 用例 2：删除 running session
46|
47|**前提条件**  
48|存在 ID 为 `ses_XXX` 的 session，状态为 running
49|
50|**命令**  
51|```bash
52|sumeru session remove ses_XXX
53|```
54|
55|**后置条件**  
56|- **text**: 输出包含 `Removed` 确认信息
57|- **json**: 返回成功响应
58|- **副作用**: 强制停止容器并删除，Session 从列表中消失
59|
60|---
61|
62|### 用例 3：不存在的 session
63|
64|**前提条件**  
65|ID 为 `ses_FAKE` 的 session 不存在
66|
67|**命令**  
68|```bash
69|sumeru session remove ses_FAKE
70|```
71|
72|**后置条件**  
73|- **text**: 输出包含 `session_not_found` 错误信息
74|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
75|- **副作用**: 无
76|- **退出码**: 非 0
77|
---

## stop — 停止


10|
11|停止正在运行的 session。
12|
13|## 参数
14|
15|| 参数 | 类型 | 必填 | 默认值 | 说明 |
16||------|------|------|--------|------|
17|| `id` | string | 是 | — | Session ID（位置参数） |
18|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
19|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
20|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
21|
22|## 用例
23|
24|### 用例 1：正常停止
25|
26|**前提条件**  
27|存在 ID 为 `ses_XXX` 的 session，状态为 running
28|
29|**命令**  
30|```bash
31|sumeru session stop ses_XXX
32|```
33|
34|**后置条件**  
35|- **text**: 输出包含 `stopped` 或类似确认信息
36|- **json**: 返回更新后的 session 对象
37|- **副作用**: Session 状态从 running 变为 idle
38|
39|---
40|
41|### 用例 2：已 idle 时停止
42|
43|**前提条件**  
44|存在 ID 为 `ses_XXX` 的 session，状态已为 idle
45|
46|**命令**  
47|```bash
48|sumeru session stop ses_XXX
49|```
50|
51|**后置条件**  
52|- **text**: 输出包含 `session_already_idle` 错误信息
53|- **json**: 返回错误对象 `{"code": "session_already_idle", ...}`
54|- **副作用**: 无
55|- **退出码**: 非 0
56|
57|---
58|
59|### 用例 3：不存在的 session
60|
61|**前提条件**  
62|ID 为 `ses_FAKE` 的 session 不存在
63|
64|**命令**  
65|```bash
66|sumeru session stop ses_FAKE
67|```
68|
69|**后置条件**  
70|- **text**: 输出包含 `session_not_found` 错误信息
71|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
72|- **副作用**: 无
73|- **退出码**: 非 0
74|
---

## turns — 查看对话轮次


15|
16|列出 session 的所有对话轮次（turns），支持多种过滤和实时订阅。
17|
18|## 参数
19|
20|| 参数 | 类型 | 必填 | 默认值 | 说明 |
21||------|------|------|--------|------|
22|| `id` | string | 是 | — | Session ID（位置参数） |
23|| `--after` | number | 否 | — | 只返回 ID > N 的 turns（游标分页） |
24|| `-w, --watch` | boolean | 否 | false | 实时流式输出新 turn |
25|| `--system` | boolean | 否 | false | 包含 system prompt |
26|| `--limit` | number | 否 | 50 | 返回条数上限 |
27|| `--offset` | number | 否 | 0 | 跳过前 N 条 |
28|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
29|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
30|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
31|
32|## 用例
33|
34|### 用例 1：正常列出
35|
36|**前提条件**  
37|存在 ID 为 `ses_XXX` 的 session，已有若干 turns
38|
39|**命令**  
40|```bash
41|sumeru session turns ses_XXX
42|```
43|
44|**后置条件**  
45|- **text**: 输出包含 `[user]`、`[assistant]`、`[tool]` 角色标记
46|- **json**: 返回 turns 数组，每个元素包含 role、content、timestamp 等字段
47|- **副作用**: 无
48|
49|---
50|
51|### 用例 2：空 turns
52|
53|**前提条件**  
54|存在 ID 为 `ses_XXX` 的新 session，无任何消息
55|
56|**命令**  
57|```bash
58|sumeru session turns ses_XXX
59|```
60|
61|**后置条件**  
62|- **text**: 无输出或提示空
63|- **json**: 返回空数组 `[]`
64|- **副作用**: 无
65|
66|---
67|
68|### 用例 3：--after N
69|
70|**前提条件**  
71|存在 ID 为 `ses_XXX` 的 session，已有多个 turns
72|
73|**命令**  
74|```bash
75|sumeru session turns ses_XXX --after 5
76|```
77|
78|**后置条件**  
79|- **text**: 只显示 ID > 5 的 turns
80|- **json**: 数组中所有元素的 ID 均 > 5
81|- **副作用**: 无
82|
83|---
84|
85|### 用例 4：--watch
86|
87|**前提条件**  
88|存在 ID 为 `ses_XXX` 的 session
89|
90|**命令**  
91|```bash
92|sumeru session turns ses_XXX --watch
93|```
94|
95|**后置条件**  
96|- **行为**: 持续输出新 turn（实时流式）
97|- **副作用**: 无（仅订阅）
98|
99|---
100|
101|### 用例 5：tool call 显示
102|
103|**前提条件**  
104|存在 ID 为 `ses_XXX` 的 session，assistant turn 包含 tool call
105|
106|**命令**  
107|```bash
108|sumeru session turns ses_XXX
109|```
110|
111|**后置条件**  
112|- **text**: Tool call 显示为 `→ name(args)` 格式
113|- **json**: Turn 对象中包含 tool_calls 字段
114|- **副作用**: 无
115|
116|---
117|
118|### 用例 6：discriminated union
119|
120|**前提条件**  
121|存在 ID 为 `ses_XXX` 的 session，包含 assistant 和 tool turns
122|
123|**命令**  
124|```bash
125|sumeru session turns ses_XXX --format json
126|```
127|
128|**后置条件**  
129|- **json**: Assistant turn 和 tool turn 具有不同的结构（discriminated union）
130|- **副作用**: 无
131|
---

## snapshot — 快照容器


13|
14|将 session 当前容器状态快照为新的 prototype 镜像。
15|
16|## 参数
17|
18|| 参数 | 类型 | 必填 | 默认值 | 说明 |
19||------|------|------|--------|------|
20|| `id` | string | 是 | — | Session ID（位置参数） |
21|| `name` | string | 是 | — | 新 prototype 名称（位置参数） |
22|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
23|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
24|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
25|
26|## 用例
27|
28|### 用例 1：正常快照
29|
30|**前提条件**  
31|存在 ID 为 `ses_XXX` 的 session
32|
33|**命令**  
34|```bash
35|sumeru session snapshot ses_XXX my-new-proto
36|```
37|
38|**后置条件**  
39|- **text**: 输出包含 `Snapshot created`、`Name: my-new-proto`、`Image: sumeru/my-new-proto:dev` 等信息
40|- **json**: 返回快照信息对象
41|- **副作用**: Docker image `sumeru/my-new-proto:dev` 被创建，可用于后续 prototype add
42|
43|---
44|
45|### 用例 2：session 不存在
46|
47|**前提条件**  
48|ID 为 `ses_FAKE` 的 session 不存在
49|
50|**命令**  
51|```bash
52|sumeru session snapshot ses_FAKE my-proto
53|```
54|
55|**后置条件**  
56|- **text**: 输出包含 `session_not_found` 错误信息
57|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
58|- **副作用**: 无
59|- **退出码**: 非 0
60|
---

## reset — 重置上下文


8|
9|重置 session 上下文（清空对话历史），可选指定新 persona。
10|
11|## 参数
12|
13|| 参数 | 类型 | 必填 | 默认值 | 说明 |
14||------|------|------|--------|------|
15|| `id` | string | 是 | — | Session ID（位置参数） |
16|| `--persona` | string | 否 | — | 新的 persona 名称 |
17|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
18|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
19|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
20|
21|## 用例
22|
23|### 用例 1：正常 reset
24|
25|**前提条件**  
26|存在 ID 为 `ses_XXX` 的 session
27|
28|**命令**  
29|```bash
30|sumeru session reset ses_XXX
31|```
32|
33|**后置条件**  
34|- **text**: 输出包含 `reset ses_XXX` 确认信息
35|- **json**: 返回成功响应
36|- **副作用**: 对话历史被清空，adapter 调用 reset subcommand
37|
38|---
39|
40|### 用例 2：带 --persona
41|
42|**前提条件**  
43|存在 ID 为 `ses_XXX` 的 session
44|
45|**命令**  
46|```bash
47|sumeru session reset ses_XXX --persona new-persona
48|```
49|
50|**后置条件**  
51|- **text**: 输出包含 `reset ses_XXX` 确认信息
52|- **json**: 返回成功响应
53|- **副作用**: 对话历史被清空，session 的 persona 被更新为 `new-persona`
54|
55|---
56|
57|### 用例 3：session 不存在
58|
59|**前提条件**  
60|ID 为 `ses_FAKE` 的 session 不存在
61|
62|**命令**  
63|```bash
64|sumeru session reset ses_FAKE
65|```
66|
67|**后置条件**  
68|- **text**: 输出包含 `session_not_found` 错误信息
69|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
70|- **副作用**: 无
71|- **退出码**: 非 0
72|
---

## logs — 查看事件日志


7|
8|查看或流式订阅 session 的事件日志（SSE）。
9|
10|## 参数
11|
12|| 参数 | 类型 | 必填 | 默认值 | 说明 |
13||------|------|------|--------|------|
14|| `id` | string | 是 | — | Session ID（位置参数） |
15|| `-f, --follow` | boolean | 否 | false | 持续输出新事件（SSE 流） |
16|| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
17|| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
18|| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
19|
20|## 用例
21|
22|### 用例 1：查看历史日志
23|
24|**前提条件**  
25|存在 ID 为 `ses_XXX` 的 session，已有若干事件
26|
27|**命令**  
28|```bash
29|sumeru session logs ses_XXX
30|```
31|
32|**后置条件**  
33|- **text**: 输出已有事件（turn、heartbeat、exit 等）
34|- **json**: 返回事件数组
35|- **副作用**: 无
36|
37|---
38|
39|### 用例 2：--follow
40|
41|**前提条件**  
42|存在 ID 为 `ses_XXX` 的 session
43|
44|**命令**  
45|```bash
46|sumeru session logs ses_XXX --follow
47|```
48|
49|**后置条件**  
50|- **行为**: 持续输出新事件（SSE 流）
51|- **副作用**: 无（仅订阅）
52|
53|---
54|
55|### 用例 3：session 不存在
56|
57|**前提条件**  
58|ID 为 `ses_FAKE` 的 session 不存在
59|
60|**命令**  
61|```bash
62|sumeru session logs ses_FAKE
63|```
64|
65|**后置条件**  
66|- **text**: 输出包含 `session_not_found` 错误信息
67|- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
68|- **副作用**: 无
69|- **退出码**: 非 0
70|