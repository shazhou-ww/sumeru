# Sumeru 🏔️

> 芥子纳须弥 — 一粒芥子里装一座须弥山

Sumeru 是一个 **Agent 运行时**：一个 HTTP 服务，管理多个 AI coding agent 的生命周期。定义 agent 的身份（persona）、能力（model）、运行环境（Docker 容器），Sumeru 负责启停、资源隔离、多轮会话和全量 turn 记录。

当前版本：**0.3.0**

## 核心概念

| 概念 | 本质 | 说明 |
|------|------|------|
| **Session** | Docker container | 一次 agent 会话实例，支持多轮对话，`docker stop/start` 保留状态 |
| **Prototype** | Docker image tag | 可运行的 agent 模板，从 `sumeru.harness` label 自动发现 |
| **Persona** | SQLite 记录 | agent 身份：instructions (system prompt) + skills |
| **Harness** | 内置适配器 | 对应特定 Agent CLI（hermes / codex / claude-code / cursor-agent / sarsapa）|

```
Persona (谁) + Model (用什么) + Prototype (怎么跑) = Session (干活)
```

## 支持的 Agent

| Adapter | Agent CLI | 说明 |
|---------|-----------|------|
| **sarsapa** | 内置 ReAct loop | 轻量原生 agent，直接调 LLM API |
| **hermes** | `hermes acp` | Hermes Agent（ACP 协议，全功能）|
| **codex** | `codex` | OpenAI Codex CLI |
| **claude-code** | `claude` | Anthropic Claude Code CLI |
| **cursor-agent** | `cursor-agent` | Cursor Agent CLI |

## Quick Start

```bash
# 1. 安装依赖 & 构建
pnpm install && pnpm run build

# 2. 初始化（配置 provider + 构建基础镜像）
sumeru setup --root-dir /opt/sumeru-data \
  --provider anthropic --api-key "$ANTHROPIC_API_KEY" \
  --model claude-sonnet-4

# 3. 启动 Host
sumeru server start

# 4. 创建 Session（给 agent 派任务）
sumeru session add --prototype sarsapa --project ./my-repo \
  --task "实现一个 hello world HTTP server"

# 5. 查看实时输出
sumeru session logs <session-id> --follow

# 6. 多轮对话
sumeru session send <session-id> "加上 /health 端点"
```

## CLI 命令一览

```
sumeru setup                                    — 一键初始化
sumeru server { start | stop | status }         — 管理 Host 进程

sumeru session list                             — 列出所有 session
sumeru session add --prototype <name> ...       — 创建 session
sumeru session send <id> "message"              — 发送后续消息
sumeru session logs <id> [--follow]             — 查看 turn 输出
sumeru session stop <id>                        — 停止 session
sumeru session remove <id>                      — 删除 session

sumeru prototype list                           — 列出可用 prototypes
sumeru image build <name> --agent <type>        — 构建 Docker 镜像

sumeru provider { list | add | remove } <name>  — Provider 管理
sumeru persona { list | get | put } <name>      — Persona 管理
sumeru search <query>                           — 搜索 session 历史
```

## API

Host 暴露 REST API（默认 `http://127.0.0.1:7900`）：

| Method | Endpoint | 说明 |
|--------|----------|------|
| GET | `/` | Host 状态 |
| GET | `/prototypes` | 列出可用 prototypes |
| GET | `/sessions` | 列出所有 sessions |
| POST | `/sessions` | 创建 session（指定 prototype + project + task）|
| GET | `/sessions/:id` | Session 详情 |
| GET | `/sessions/:id/events` | SSE 事件流（实时 turns）|
| POST | `/sessions/:id/messages` | 发送后续消息（多轮）|
| DELETE | `/sessions/:id` | 删除 session |
| POST | `/sessions/:id/commands` | 统一命令 API（model/reset/install-skill/snapshot）|

## 项目结构

```
packages/
  core/           — 共享类型定义（零运行时依赖）
  adapter-core/   — Adapter 框架 + NDJSON 协议
  host/           — HTTP 服务 + Docker transport + session 管理
  cli/            — CLI 客户端（sumeru 命令）
  sarsapa/        — 内置轻量 agent（ReAct loop）
  adapter-hermes/ — Hermes ACP adapter
  adapter-codex/  — Codex CLI adapter
  adapter-claude-code/ — Claude Code adapter
  adapter-cursor-agent/ — Cursor Agent adapter
  sumeru-session/ — 容器内统一入口（检测 agent 类型并路由）
  base/           — 基础 Docker image (Dockerfile)
docker/
  selftest/       — 自测 prototype（Dockerfile + persona）
deploy/
  sumeru.service  — systemd 部署配置
```

## Docker 架构

所有 agent 运行在 Docker 容器内。镜像继承树：

```
sumeru/base:dev            ← node:24-slim + python 3.12 + 通用工具
  ├── sumeru/sarsapa:dev   ← 内置 agent（无外部 CLI）
  ├── sumeru/hermes:dev    ← + hermes-agent[acp]
  ├── sumeru/codex:dev     ← + codex CLI
  ├── sumeru/claude-code:dev ← + claude CLI
  └── sumeru/cursor-agent:dev ← + cursor-agent
```

**Session 生命周期**：
1. `POST /sessions` → `docker run` 新容器
2. `docker exec` 启动 adapter 进程（通过 sumeru-session 路由）
3. Agent 完成任务 → `done` → session idle（容器保持 running，支持多轮）
4. 显式 stop / 超时 → `docker stop`（writable layer 保留）
5. 再次发消息 → `docker start` → 恢复

**Project 挂载**：`-v /host/path/to/repo:/workspace:rw`，agent cwd = `/workspace`。

## 开发

```bash
pnpm install           # 安装依赖
pnpm run build         # 编译所有包
pnpm run check         # Biome lint
npx vitest run         # 运行测试（326 tests）
npx tsc --noEmit       # 类型检查
```

构建 Docker 镜像：
```bash
sumeru image build sarsapa --agent sarsapa
sumeru image build hermes --agent hermes
```

## 部署

见 [deploy/README.md](deploy/README.md) — systemd user service 方式。

## License

Private.
