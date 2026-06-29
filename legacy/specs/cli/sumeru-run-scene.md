---
scenario: "sumeru run <scene> 一次性场景实验：读 scene YAML → 建 Docker 容器 → 容器内起 Sumeru + 配置 gateway → 发 task prompt → 等待完成或 timeout → 导出完整 recording 为 tar.gz → 销毁容器（复用 Docker 模式基础设施）"
feature: cli-run
tags: [cli, run, scene, docker, container, isolation, recording, export, phase-7]
---

## Given

- `specs/architecture/architecture.md` → 「部署模式 → 场景实验（`sumeru run`）」(L409-418) 声明：
  > 1. 从 scene 定义创建 Docker 容器
  > 2. 容器内启动 Sumeru + 配置 gateway
  > 3. 发送 task prompt
  > 4. 等待完成或 timeout
  > 5. 导出 recording
  > 6. 销毁容器
  > 底层完全复用 Docker 模式的基础设施。
- `specs/architecture/docker-mode.md` 已实现：镜像 `sumeru:latest`、named volume `sumeru-ocas`、`docker/docker-compose.yaml`、API 对等契约。
- 仓库已有示例 scene：`scenes/first-uwf-usage/scene.yaml`（本 spec 的格式基线）。
- `@sumeru/cli` 已发布 `start` / `docker start` 子命令（见 `server-start-listens.md`、`docker-mode.md`）。
- 宿主机已安装 Docker（本 spec 的 `run` 全程依赖容器；无 Docker 时的错误处理见 Then-9）。

### CLI 表面

`sumeru run <scene>` 新增子命令：

| 选项 | 说明 | 默认 |
|------|------|------|
| `<scene>` (positional) | scene 目录路径或 scene.yaml 文件路径 | （必填）|
| `--gateway <name>` | 用哪个 agent gateway 执行 task | scene 的 `gateway` 字段，再缺省 `hermes` |
| `--timeout <ms>` | 单次 task 的 wall-clock 上限（含 agent + 网络）| `1800000`（30 min）|
| `--output <path>` | 导出 tar.gz 的写出路径 | `./recordings/<scene-name>-<timestamp>.tar.gz` |
| `--port <number>` | 宿主机映射端口（透传 compose `SUMERU_PORT`）| `0`（OS 分配空闲口，避免并发跑多个 scene 撞端口）|
| `--keep` | 跑完不销毁容器（保留现场排查）| 不保留 |
| `--no-export` | 跳过导出（与 `--keep` 配合，仅观察）| 默认导出 |

### Scene YAML 格式（行为契约）

以 `scenes/first-uwf-usage/scene.yaml` 为基线：

```yaml
name: first-uwf-usage
description: >
  新用户首次使用 uwf。没有预装任何 skill 或 memory，
  从零开始摸索工具，创建 workflow 并执行。

gateway: hermes          # 可选，缺省 hermes；--gateway 覆盖
tools: [uwf, git, node]  # agent 可用工具集（声明性）
knowledge:
  skills: []             # 预装 skills
  memory: []             # 预装 memory

task: |
  你是一个开发者 agent，刚接到一个新的开发环境。
  ...
```

字段语义（本 spec 规定）：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `name` | ✅ | `string`（`^[a-z0-9-]+$`，kebab-case）| scene 标识，用于容器名、导出文件名、session-meta 备注 |
| `description` | ❌ | `string` | 仅人类可读；不进入 agent 上下文 |
| `gateway` | ❌ | `string` | 选定 agent；`--gateway` 覆盖 |
| `tools` | ❌ | `string[]`，缺省 `[]` | 声明 agent 可用工具；写入 session-meta，MVP 不强制容器侧安装（容器镜像自带 git/node；`uwf` 等需 scene 自行确保可用或镜像扩展）|
| `knowledge.skills` | ❌ | `string[]`，缺省 `[]` | 预装 skills；MVP 记录进 session-meta，**不**实际加载（留作后续阶段）|
| `knowledge.memory` | ❌ | `string[]`，缺省 `[]` | 预装 memory；MVP 同上 |
| `task` | ✅ | `string`（非空，多行 `|` block）| 发往 agent 的 task prompt，整段作为单条 user message |

**未知字段容忍**（与 `config-load-*.md` 一致）：scene YAML 出现未列字段不报错，仅忽略并 `[sumeru] scene: ignoring unknown field <k>` warn 一行。

## When

### When-1：happy path 全流程

- 操作者在仓库根目录运行：`sumeru run scenes/first-uwf-usage --gateway hermes --timeout 600000`。

### When-2：参数变体

- (a) `sumeru run scenes/first-uwf-usage/scene.yaml`（指向文件而非目录）
- (b) `sumeru run scenes/first-uwf-usage`（目录，自动找 `scene.yaml`）
- (c) `sumeru run scenes/first-uwf-usage --keep --no-export`（保留现场、不导出）
- (d) `sumeru run scenes/first-uwf-usage --port 0`（并发跑多个 scene，端口不撞）

### When-3：scene 校验失败

- (a) scene 缺 `name`
- (b) scene 缺 `task` / `task` 为空串
- (c) `name` 不匹配 `^[a-z0-9-]+$`（如含大写 / 空格 / 下划线）
- (d) 指向的路径不存在
- (e) 指向目录但目录内无 `scene.yaml`

### When-4：超时

- task 在 `--timeout` 内未到 `event: done`。

### When-5：agent 出错

- SSE 流里出现 `event: error`（adapter 失败，见 `server-message-sse-endpoint.md` 的 adapter failure 契约）。

### When-6：导出阶段失败

- 容器跑完 task，但 `POST .../export` 端点返回非 200（如 404 session 不在 / 500）。

## Then

### Then-1：scene 加载与校验

- **目录 vs 文件**：(a) 与 (b) 行为一致 —— CLI 接收路径后，若为目录则追加 `/scene.yaml` 解析，若为文件直接解析。
- **未知字段**：容忍，仅 warn。
- **校验失败**（When-3 各项）：
  - 退出码 `1`，stderr 单行（无 stack trace）：
    - (a) `Scene is missing required field 'name'.`
    - (b) `Scene is missing required field 'task' (or it is empty).`
    - (c) `Scene 'name' must match ^[a-z0-9-]+$ (got '<value>').`
    - (d) `Scene not found: <path>`
    - (e) `No scene.yaml in directory: <path>`
  - **不建容器、不发请求、不写任何文件**（失败即早退，零副作用）。

### Then-2：容器创建（复用 Docker 模式）

- CLI 在 `--port 0` 下向 compose 注入变量并启动一个**临时**栈（容器/网络命名空间隔离到本次 run，便于并发与销毁）：
  - 复用 `docker-mode.md` 的 image `sumeru:latest` 与 compose 模板。
  - 容器名 / project 名带 scene + 随机后缀（如 `sumeru-run-first-uwf-usage-<8hex>`），避免并发 run 撞名。
  - `gateway` 由 `--gateway` > scene `gateway` > `hermes` 解析；据此**生成**一份临时 `sumeru.yaml`（仅含该单 gateway）挂载进容器，而非要求仓库预置 scene 专用配置。
  - ocas 仍走 named volume（复用 `sumeru-ocas` 或本次 run 独立 volume，二选一，默认复用以便 cross-run 分析；`--keep` 场景下保留独立 volume）。
- 容器启动后轮询 `GET /` 直到 200（最多 30s）；超时则报 `Timed out waiting for container to become healthy.` 退出 1，并执行 `--keep` 未设时的清理（销毁容器）。

### Then-3：容器内 Sumeru + gateway 就绪后发 task

- CLI `POST /gateways/<gateway>/sessions` 建一个 session，`config` 透传 scene 决定的 cwd（解析为 `/workspace`）等 —— 与本机模式一致（`config` opaque，Sumeru 透传）。
- session 创建成功（201）后，CLI `POST .../sessions/<id>/messages`，body `{ "content": "<task prompt 整段>" }`，`Accept: text/event-stream`。
- **单条 user message**：`task` 字段作为**一整条** content 发出（不做分段、不做 system/user 角色切分 —— architecture 规定调用方永远发 user role）。

### Then-4：完成判定与超时（When-1 / When-4）

- **完成 = SSE 收到 `event: done`**（见 `server-message-sse-endpoint.md` 的 done 契约）。done 的 `@sumeru/summary` 携带 `turnCount` / `tokens` / `durationMs`。
- CLI 边收边落本地日志（turn 行实时 echo 到 stdout 便于观察），但不阻塞判定。
- **超时（When-4）**：自 `POST .../messages` 起 wall-clock 达 `--timeout` 仍未 done：
  - CLI 主动断开 SSE 连接。
  - stderr单行：`Timed out after <ms>ms (<turnsReceived> turns received).`
  - **仍继续执行导出**（见 Then-5）—— 已收到的 turn 即有效 recording。
  - 退出码 `124`（区别于成功 0 与 scene 错误 1）。

### Then-5：导出完整 recording 为 tar.gz（When-1）

- task 收到 done（或超时）后，CLI `POST /gateways/<gateway>/sessions/<id>/export`（Phase-5 端点，见 `server-session-export-endpoint.md`）。
- 响应 200 + `application/gzip`，body 流式写出到 `--output`（默认 `./recordings/<scene-name>-<timestamp>.tar.gz`）。
- tar.gz **自包含**（含 session-meta + 全部 turn + schema 链），可用 `ocas import <file>` 在别处复现 —— 与本机模式导出**字节同构**（ocas 内容寻址）。
- 导出成功后 stdout 打印一行摘要：`Exported <N> nodes → <output-path> (<bytes> bytes).`（`N` 取自响应 `X-Sumeru-Export-Nodes` 头）。

### Then-6：销毁容器

- 导出完成（成功 or 超时后导出）后，**默认**销毁容器：CLI `docker compose down`（不带 `-v`，ocas 在复用 volume 模式下保留以便 cross-run 分析；`--keep` 模式下不销毁，留给排查）。
- 销毁成功后 stdout 单行 `Container removed.`。
- **异常路径下的清理保证**：任何阶段失败（容器不健康、agent error、导出失败、超时）只要 `--keep` 未设，CLI 在退出前**必**触发销毁（`try/finally` 语义）。清理失败不掩盖主错误，仅追加 stderr `Warning: failed to remove container <name> (<reason>).`。

### Then-7：agent 出错（When-5）

- SSE 出现 `event: error`（`@sumeru/error`，`value.error` 形如 `adapter_error`）：
  - CLI 仍尝试导出（error 之前的 turn 仍是有效 recording，与 `server-message-sse-endpoint.md`「adapter errors are recoverable」一致）。
  - 导出后销毁容器。
  - stderr 单行：`Agent error: <value.message>（已导出 <N> turns 前的 recording → <output-path>）。`
  - 退出码 `502`（与 HTTP 502 底层 agent 通信失败语义对齐）。

### Then-8：导出失败（When-6）

- export 端点返回非 200：
  - 不写文件（或写一半则删掉半成品）。
  - 销毁容器（仍走清理保证）。
  - 退出码 `1`，stderr `Failed to export recording: HTTP <status> (<value.message>).`
  - **不**因导出失败而丢弃已跑出的 turn —— 提示操作者重跑或 `--keep` 现场，但不自动重试。

### Then-9：无 Docker / 无可用 image

- `docker` 不在 PATH，或 `sumeru:latest` 镜像不存在（`docker image inspect` 非 0）：
  - 退出码 `1`，stderr 单行之一：
    - `Docker is not available. Install Docker or run 'sumeru start' for local mode.`（无 docker）
    - `Image 'sumeru:latest' not found. Build it first: docker build -t sumeru:latest -f docker/Dockerfile .`（无镜像）
  - **不**建容器、不发请求。

### 退出码总表

| 码 | 含义 |
|----|------|
| `0` | task 正常 done + 导出成功（含 `--keep` 不销毁）|
| `1` | scene 校验失败 / 容器不健康 / 导出失败 / 无 Docker / 无镜像 |
| `124` | 超时（已尽力导出已收 turn）|
| `502` | agent 出错（已尽力导出 error 前的 turn）|

### Tests（gated on Docker + 真实 agent 可选）

- 测试目录 `packages/cli/tests/run-scene.test.ts`，分两档门控：
  - **无 agent 档**（默认运行）：用 stubbed adapter（注入 `spawnFn` / 内部 seam 返回固定 turn 流）覆盖 scene 校验、容器生命周期、超时、销毁清理、退出码。断言「零副作用」：失败路径下不留容器、不留文件。
  - **真实 agent 档**（`SUMERU_RUN_INTEGRATION=1`）：跑 `scenes/first-uwf-usage` 真实往返，断言导出的 tar.gz 含 ≥1 个 turn + session-meta + schema 链（解压后断言 `cas/*.bin` 存在，复用 `server-session-export-endpoint.md` 的 tar 布局契约）。
- 具体断言：
  - **校验失败早退**：When-3 五项各跑一遍，断言退出码 1 + 文档化信息 + `docker ps` 无残留容器 + `recordings/` 无新文件。
  - **happy path（stubbed）**：断言 stdout 出现 `Exported <N> nodes → <path>`，文件存在且 `gunzip | tar -t` 列出 `cas/*.bin` + `vars.jsonl` + `tags.jsonl`；退出码 0；`docker ps` 无残留。
  - **超时**：stubbed adapter 永不 done，`--timeout 1000` → 退出码 124 + 仍导出已收 turn + 清理容器。
  - **agent error**：stubbed adapter 触发 `event: error` → 退出码 502 + 导出 error 前 turn。
  - **--keep**：happy path + `--keep` → 退出码 0 + `docker ps` **仍**有该容器（操作者可 `docker exec` 进去排查）。
  - **并发不撞**：两个 `sumeru run` 并发（不同 scene / 同 scene）→ `--port 0` 各自 OS 分配端口，互不抢占，均退出 0。
  - **清理保证**：在导出阶段注入失败，断言容器仍被销毁（try/finally）。
- 所有既有测试继续原样通过。

### Documentation

- `README.md` 新增「场景实验」小节：4–8 行，给 `sumeru run scenes/first-uwf-usage` 示例 + 「跑完产出 `recordings/*.tar.gz`，可用 `ocas import` 复现」+ 退出码表链接。
- 链回 architecture.md「部署模式 → 场景实验」、`docker-mode.md`、`server-session-export-endpoint.md`。

## Non-goals

- **不**实现 `knowledge.skills` / `memory` 的实际加载 —— MVP 仅记录进 session-meta（标注「预装」但容器侧不真正注入）；真正加载是后续阶段。
- **不**强制 `tools` 字段对应的工具在容器内可用 —— 声明性；镜像扩展 / scene 自带 setup 由 scene 作者负责。
- **不**做多次 send / 多轮对话 —— `task` 是单条 user message，done 即结束；要多轮用 `docker start` 起常驻容器再手动 `POST`。
- **不**做 scene 的版本管理 / 依赖锁定 / 多 scene 编排（批量跑 N 个 scene 用 shell 循环 + `--port 0` 即可）。
- **不**在 run 失败时自动重试 —— 一次性实验，失败即退出并保留现场（`--keep` 或导出的部分 recording）。
- **不**重复实现 Docker 编排 —— 完全复用 `docker-mode.md` 的 image / compose / API 对等基础设施。
