# Sumeru 🏔️

> 芥子纳须弥 — 一粒芥子里装一座须弥山

Sumeru 是一个 **Agent 运行时**：一个 HTTP 服务，管理多个 AI coding agent 的生命周期。你定义 agent 的身份（谁）、能力（用什么模型）、运行环境（Docker 容器），Sumeru 负责启停、资源隔离、会话管理和全量记录。

**解决的问题**：当你有多种 agent（Claude Code、Codex、Hermes、自定义 agent）需要在同一台机器上并行跑任务时，手动管理进程、认证、资源限制和会话记录是噩梦。Sumeru 把这些统一为 HTTP API + CLI，一条命令创建 session，一条命令发消息。

## 核心概念

Sumeru 用四层抽象描述一个 agent：

```
Provider  ── 谁提供 API？（SiliconFlow / Anthropic / OpenAI / 自建代理）
   │
Model     ── 用哪个模型？（deepseek-v3 / claude-opus-4 / gpt-4o）
   │
Persona   ── 它是谁？（system prompt + skills）
   │
Prototype ── 组装成可运行的 agent 模板（persona + model + Docker image）
   │
Session   ── 一次对话（容器实例 + 多轮 message + 全量 turn 记录）
```

| 概念 | 存储 | 说明 |
|------|------|------|
| **Provider** | SQLite | LLM API 提供方。`apiType`（openai/anthropic）、`baseUrl`、`apiKey` |
| **Model** | SQLite | 引用一个 Provider，指定具体模型名、context window、tool use 开关 |
| **Persona** | SQLite | agent 的身份：instructions（system prompt）+ skills 列表 |
| **Prototype** | YAML 文件 | 组装层：`persona` + `model` + `image`（Docker 镜像）+ 资源 defaults |
| **Session** | 内存 + ocas | 一次 agent 对话实例，`ses_` + ULID。支持多次 message 延续 |
| **Adapter** | npm 包 | 每类 agent 一个适配器，实现 NDJSON stdin/stdout 协议 |
| **Image** | images.yaml | Docker 镜像注册表，记录 dockerfile、构建时间、digest |

### 依赖链

```
Provider → Model → Persona → Prototype → Session
```

创建时必须按依赖序（先 Provider 再 Model），删除时有引用保护（删 Provider 前必须先删引用它的 Model）。

## Quick Start

### 1. 安装

```bash
pnpm add -g @sumeru/cli
```

### 2. 一键 setup

```bash
sumeru setup \
  --provider siliconflow \
  --api-key sk-your-key \
  --model deepseek-ai/DeepSeek-V3 \
  --root-dir ./my-sumeru
```

自动创建目录结构、host.yaml、.env、Provider、Model、默认 Persona。幂等可重跑。

### 3. 构建 Agent 镜像

```bash
cd my-sumeru
sumeru image build sarsapa --agent sarsapa
```

自动 Docker build + 注册到 images.yaml。支持的 agent type：`sarsapa`、`hermes`、`claude-code`、`codex`。

### 4. 注册 Prototype

```bash
sumeru prototype add sarsapa --model deepseek-v3 --image sarsapa --persona default
```

### 5. 启动 Host

```bash
sumeru server start
```

### 6. 创建 Session 开始工作

```bash
sumeru create sarsapa --project ~/my-project --task "Fix the login bug"

# 查看 session 列表
sumeru sessions

# 跟踪日志
sumeru logs ses_01KXYZ... --follow

# 发送后续消息
sumeru send ses_01KXYZ... "Also update the tests"
```

## HTTP API

所有响应使用 envelope 格式 `{ type: "@sumeru/<entity>", value: ... }`。

### Host

```
GET  /                     → @sumeru/host（名称、版本、运行状态、uptime）
```

### Provider（SQLite CRUD）

```
GET    /providers           → @sumeru/provider-list
POST   /providers/:name     → 201 @sumeru/provider
GET    /providers/:name     → @sumeru/provider
PUT    /providers/:name     → @sumeru/provider
DELETE /providers/:name     → 204
```

请求 body：`{ "apiType": "openai"|"anthropic", "baseUrl": "...", "apiKey": "..." }`

### Model（SQLite CRUD）

```
GET    /models              → @sumeru/model-list
POST   /models/:id          → 201 @sumeru/model
GET    /models/:id          → @sumeru/model
PUT    /models/:id          → @sumeru/model
DELETE /models/:id          → 204
```

请求 body：`{ "provider": "...", "model": "...", "contextWindow": 128000 }`

- `provider`：必须是已存在的 Provider name
- `model`：LLM model name（如 `deepseek-ai/DeepSeek-V3`），**不是** Sumeru 内部 ID
- URL 中的 `:id` 是 Sumeru 内部 ID，和 `model` 字段是两个东西

### Persona（SQLite CRUD）

```
GET    /personas            → @sumeru/persona-list
POST   /personas/:name      → 201 @sumeru/persona
GET    /personas/:name      → @sumeru/persona
PUT    /personas/:name      → @sumeru/persona
DELETE /personas/:name      → 204
```

请求 body：`{ "instructions": "...", "skills": ["skill-a", "skill-b"] }`

- `skills` 引用 SQLite 中的 Skill name，创建时会校验是否存在

### Image（images.yaml CRUD）

```
GET    /images              → @sumeru/image-list
GET    /images/:name        → @sumeru/image
POST   /images/:name        → @sumeru/image（注册/更新）
DELETE /images/:name        → 204
```

请求 body：`{ "name": "...", "description": "...", "dockerfile": "...", "builtAt": "...", "digest": "..." }`

`sumeru image build` 成功后自动注册。`prototype add --image` 引用注册名，创建时校验存在。

### Prototype（YAML CRUD）

```
GET    /prototypes          → @sumeru/prototype-list
GET    /prototypes/:name    → @sumeru/prototype
POST   /prototypes/:name   → 201 @sumeru/prototype
DELETE /prototypes/:name   → 204
```

请求 body：`{ "name": "...", "persona": "...", "model": "...", "image": "..." }`

创建时校验 `persona`、`model`、`image` 引用均存在。Prototype 也可通过 `data/prototypes/*.yaml` 文件加载。

### Session

```
GET    /sessions             → @sumeru/session-list
POST   /sessions             → 201 @sumeru/session
GET    /sessions/:id         → @sumeru/session
POST   /sessions/:id/stop    → @sumeru/session
DELETE /sessions/:id         → 204
```

创建 body：`{ "prototype": "sarsapa", "project": "my-project", "task": "Fix the bug" }`

支持可选字段：
- `model`：覆盖 Prototype 默认模型。`"model-id"`（SQLite Model.id）或 `{"provider": "openai", "name": "gpt-4o"}`（ad-hoc）
- `env`：注入环境变量到容器

### 发消息（resume）

```
POST /sessions/:id/messages  → 202 @sumeru/message-accepted
```

请求 body：`{ "content": "继续修 tests", "model": "alt-model" }`

- `content`：消息内容（必填）
- `model`：可选，运行时切换模型（hot-switch）
- `env`：可选，追加环境变量

### 事件流（SSE）

```
GET /sessions/:id/events  → text/event-stream
```

事件类型：
- `event: turn` — Turn 对象（assistant 回复 / tool 调用结果）
- `event: exit` — 会话结束信号（complete / failed / timeout / stopped / exhausted）
- `event: heartbeat` — 保活

支持 `Last-Event-ID` header 断点续传。

### 历史 & 搜索

```
GET  /sessions/:id/turns     → @sumeru/turn-list
GET  /sessions/:id/history   → @sumeru/history
GET  /search?q=keyword       → @sumeru/search
POST /sessions/:id/export    → tar.gz 导出
```

### Skill

```
GET    /skills/:name          → @sumeru/skill
PUT    /skills/:name          → @sumeru/skill
DELETE /skills/:name          → 204
```

Skills 以文件形式放在 `data/skills/` 下，Host 启动时自动导入 SQLite。也可通过 API 动态管理。

### 错误格式

```json
{ "type": "@sumeru/error", "value": { "error": "error_code", "message": "..." } }
```

常见错误码：

| Code | HTTP | 说明 |
|------|------|------|
| `provider_exists` | 409 | Provider 已存在 |
| `provider_in_use` | 409 | 有 Model 引用此 Provider |
| `provider_not_found` | 400 | Model 引用了不存在的 Provider |
| `model_exists` | 409 | Model 已存在 |
| `persona_exists` | 409 | Persona 已存在 |
| `persona_in_use` | 409 | 有 Prototype 引用此 Persona |
| `skills_not_found` | 400 | Persona 引用了不存在的 Skill |
| `session_not_found` | 404 | Session 不存在 |
| `session_busy` | 409 | Session 正在运行中 |
| `prototype_exists` | 409 | Prototype 已存在 |
| `prototype_not_found` | 404 | Prototype 不存在 |
| `image_not_found` | 400 | Prototype 引用了不存在的 Image |
| `invalid_body` | 400 | 请求 body 格式错误 |
| `invalid_json` | 400 | 非法 JSON |

## CLI

```
sumeru <command> [options]
```

| 命令 | 说明 |
|------|------|
| `setup --provider --api-key --model [--root-dir]` | 一键初始化（幂等） |
| `server start [--config] [--port]` | 启动 Host 服务 |
| `server stop` | 停止 Host |
| `server status` | 查看 Host 状态 |
| `prototype list` | 列出所有 Prototype |
| `prototype add <name> --model --image [--persona]` | 注册 Prototype |
| `prototype remove <name>` | 删除 Prototype |
| `provider list` | 列出 Provider |
| `provider add <name> --api-type --base-url [--api-key]` | 添加 Provider |
| `provider remove <name>` | 删除 Provider |
| `model list` | 列出 Model |
| `model add <id> --provider --model [--context-window]` | 添加 Model |
| `model remove <id>` | 删除 Model |
| `sessions` | 列出 Session |
| `create <prototype> --project --task` | 创建 Session |
| `send <session_id> <message>` | 发送消息 |
| `logs <session_id> [--follow]` | 查看 Session 日志 |
| `stop <session_id>` | 停止 Session |
| `delete <session_id>` | 删除 Session |
| `image build <name> --agent <type> [--adapter <path>]` | 构建 Docker 镜像并注册 |
| `image list` | 列出已注册镜像 |

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SUMERU_HOST` | `127.0.0.1` | API client 连接地址 |
| `SUMERU_PORT` | `7900` | API client 连接端口 |
| `SUMERU_PID_FILE` | 自动推导 | PID 文件路径 |

## Packages

| 包 | 说明 |
|---|---|
| `@sumeru/core` | 共享类型定义（零运行时依赖） |
| `@sumeru/adapter-core` | Adapter 通用框架（NDJSON 协议入口） |
| `@sumeru/sarsapa` | 内置轻量 agent（单 session native agent） |
| `@sumeru/adapter-claude-code` | Claude Code CLI 适配器 |
| `@sumeru/adapter-codex` | OpenAI Codex CLI 适配器 |
| `@sumeru/adapter-hermes` | Hermes Agent 适配器 |
| `@sumeru/host` | Host HTTP 服务 + Transport 层 |
| `@sumeru/cli` | CLI 工具 |

## 配置参考

### host.yaml

```yaml
name: sumeru@local          # 实例名（必填）
maxRunning: 3               # 最大并行 session 数（必填）
workspaceRoot: /workspace   # 容器内工作目录根（必填）
envFile: .env               # 环境变量文件路径（必填）
defaults:                   # 可选：session 默认值
  timeout: 120              # 秒
  maxTurns: 20
  resources:
    cpu: 2                  # ⚠️ number，不是 Docker 的 cpus 字符串
    memory: "4g"            # ⚠️ string，不是 Docker 的 mem_limit
```

> **注意**：v3 起 `models` 和 `resourceLimits` 字段已废弃。模型配置迁移到 SQLite（Provider + Model），通过 API/CLI 管理。旧配置会打印 deprecation warning 但不报错。

### images.yaml

```yaml
images:
  hermes:
    description: "Sumeru hermes image (sumeru/hermes:dev)"
    dockerfile: "docker/hermes/Dockerfile"
    builtAt: "2026-07-01T09:17:24.720Z"
    digest: "sha256:c3428a77732cf..."
  sarsapa:
    description: "Sumeru sarsapa image (sumeru/sarsapa:dev)"
    dockerfile: "docker/sarsapa/Dockerfile"
    builtAt: "2026-07-01T09:07:49.225Z"
    digest: "sha256:14d06f538bc62..."
```

通过 `sumeru image build` 自动维护，无需手写。

### Prototype YAML

```yaml
name: sarsapa
persona: sarsapa-worker     # → SQLite Persona.name
model: deepseek-v4-pro      # → SQLite Model.id
image: sarsapa              # → images.yaml 注册名（sumeru image build 注册）
defaults:                   # 可选，覆盖 host defaults
  maxTurns: 40
  timeout: 300
  resources:
    cpu: 4
    memory: "8g"
```

## Development

```bash
pnpm install
pnpm run build        # TypeScript 编译
pnpm run test         # vitest（185 tests）
pnpm run check        # biome lint
pnpm run typecheck    # tsc --noEmit
```

## 部署

Sumeru 作为**用户级常驻服务**运行。Linux 用 systemd user service，macOS 用 launchd LaunchAgent。

### Linux：systemd

```bash
# 安装 unit 文件
mkdir -p ~/.config/systemd/user
cp deploy/sumeru.service ~/.config/systemd/user/

# 配置 adapter 认证（如果用 CLI-based adapter）
mkdir -p ~/.config/sumeru
cp deploy/sumeru.env.example ~/.config/sumeru/env
chmod 600 ~/.config/sumeru/env
$EDITOR ~/.config/sumeru/env

# 启用
systemctl --user daemon-reload
systemctl --user enable --now sumeru
```

```bash
journalctl --user -u sumeru -f    # 日志
systemctl --user restart sumeru   # 重启
systemctl --user status sumeru    # 状态
```

### macOS：launchd

```bash
mkdir -p ~/.config/sumeru
cp deploy/sumeru-launchd-run.sh.example ~/.config/sumeru/launchd-run.sh
chmod 755 ~/.config/sumeru/launchd-run.sh

sed "s|__HOME__|$HOME|g" deploy/sumeru.plist.example \
  > ~/Library/LaunchAgents/work.shazhou.sumeru.plist

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/work.shazhou.sumeru.plist
launchctl kickstart -k gui/$(id -u)/work.shazhou.sumeru
```

```bash
launchctl print gui/$(id -u)/work.shazhou.sumeru     # 状态
launchctl kickstart -k gui/$(id -u)/work.shazhou.sumeru  # 重启
launchctl bootout gui/$(id -u)/work.shazhou.sumeru   # 停止
tail -f ~/.config/sumeru/sumeru.log                  # 日志
```

> CLI-based adapter（claude-code / codex / cursor-agent）需要 PATH 和 API key。systemd/launchd 不继承 login shell 环境，必须在 env 文件或 wrapper 脚本中显式声明。

## Name

> 须弥山 — 佛教宇宙观中的世界中心。一粒芥子里装一座须弥山 — 一个小小的 HTTP 服务里，容纳了整个 agent 世界。
