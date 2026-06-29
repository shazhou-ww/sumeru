# Sumeru 🏔️

> 芥子纳须弥 — 一粒芥子里装一座须弥山

**Agent house** — 一个 HTTP 服务，为同一运行环境内的多个 agent 提供统一的收发室，所有交互通过 ocas 全量记录。

## 核心概念

```
Host (一个进程，一个 HTTP endpoint)
  │
  ├─ Prototype: software-engineer (manifest + compose)
  │    └─ Session ses_01JXYZ → Docker container + adapter
  │
  └─ Prototype: code-reviewer
       └─ Session ses_01JXZZ → Docker container + adapter
```

- **Host** — 一个 Sumeru 进程，为同一运行环境内的多个 agent 提供统一的收发室
- **Prototype** — agent 模板（instructions、skills、默认资源）
- **Session** — 一次 agent 对话，`ses_` + ULID，支持多次 message 延续
- **Adapter** — 每类 agent 一个包，实现 NDJSON stdin/stdout 协议

## Quick Start

```bash
# 1. 创建 host 配置
cat > host.yaml << 'EOF'
name: sumeru@local
maxRunning: 3
workspaceRoot: /workspace
envFile: ~/.config/sumeru/.env
models:
  anthropic:
    baseUrl: null
    apiKey: sk-ant-...
  openai: null
  openrouter: null
resourceLimits: null
defaults:
  timeout: 7200000
  maxTurns: 40
  resources:
    cpu: 2
    memory: 4G
EOF

# 2. 启动服务
SUMERU_PORT=7900 sumeru-host .

# 3. 验证
curl http://127.0.0.1:7900/
# → {"type":"@sumeru/host","value":{"name":"sumeru@local","version":"0.1.0","status":{...},"uptime":...}}
```

## HTTP API

所有响应使用 ocas envelope 格式 `{ type, value }`。

### Host 信息

```
GET /  → @sumeru/host
```

### Prototype

```
GET  /prototypes           → @sumeru/prototype-list
GET  /prototypes/:name     → @sumeru/prototype
POST /prototypes/:name     → 201 @sumeru/prototype
```

### Session

```
GET    /sessions              → @sumeru/session-list
POST   /sessions              → 201 @sumeru/session (创建)
GET    /sessions/:id          → @sumeru/session (查看)
POST   /sessions/:id/stop     → @sumeru/session (停止)
DELETE /sessions/:id          → 204 (删除)
```

### 发消息

```
POST /sessions/:id/messages  → 202 @sumeru/message-accepted
```

请求 body: `{ "content": "你的消息", "env": null, "model": null }`

### 事件流 (SSE)

```
GET /sessions/:id/events  → text/event-stream
```

SSE 事件：
- `event: turn` — v3 Turn 对象
- `event: exit` — 会话结束信号（complete / failed / timeout / …）
- `event: heartbeat` — 保活

支持 `Last-Event-ID` header 断点续传。

### 历史 & 搜索

```
GET /sessions/:id/history  → @sumeru/history
GET /sessions/:id/turns    → @sumeru/turn-list
GET /search?q=keyword&session=ses_...  → @sumeru/search
POST /sessions/:id/export  → tar.gz 导出
```

## Packages

Active v3 packages (build-dependency order):

| Package | Description |
|---------|-------------|
| `@sumeru/core` | Shared type definitions (zero runtime deps) |
| `@sumeru/adapter-core` | Adapter common framework (cli-kit NDJSON entrypoint) |
| `@sumeru/adapter-claude-code` | Claude Code adapter |
| `@sumeru/host` | Host HTTP service + Transport layer |

> The previous v1 implementation is frozen under `legacy/` and is excluded from
> the workspace, build, lint, and publish.

## Configuration

Each `gateways.<name>` entry supports an optional `config:` block. The block
is forwarded verbatim to the adapter factory at boot — the YAML loader does
not validate keys against any adapter's schema, so adapter-specific options
pass through. Example: raise the claude-code adapter's `send` timeout from
the 30-minute default to 1 hour for very long tasks:

```yaml
gateways:
  claude-code:
    adapter: claude-code
    config:
      sendTimeoutMs: 3600000          # 1 h (default 30 min)
      createSessionTimeoutMs: 300000  # 5 min (default 5 min)
      maxTurns: 120                   # default 90
    capabilities:
      resume: true
      streaming: true
```

Omit `config:` entirely (or set it to `null` / `{}`) to keep the adapter's
built-in defaults. Unknown keys are passed through but ignored by the
adapter; non-mapping values (numbers, arrays) are rejected at load time.

## Development

```bash
pnpm install
pnpm run build     # tsc via proman
pnpm run test      # vitest
pnpm run check     # biome lint
```

## 网络拓扑

每个小队节点跑一个 Sumeru 实例，小队网络 = Sumeru 网络：

```
uwf/broker (session 路由层)
  │
  ├─ sumeru@neko ── hermes, claude-code
  ├─ sumeru@kuma ── hermes
  ├─ sumeru@raku ── hermes
  └─ sumeru@sora ── hermes
```

详细设计见 [specs/architecture.md](specs/architecture.md)。

## 部署

Sumeru 作为**用户级常驻服务**运行，与 `hermes-gateway.service` 完全解耦，gateway
重启不再影响 Sumeru。Linux 用 **systemd user service**，macOS 用 **launchd
LaunchAgent** —— 两者保证对等：登录自启 + 崩溃自愈 + 独立进程树。

### Linux：systemd user service

```bash
# 1. 复制或符号链接 unit 文件
mkdir -p ~/.config/systemd/user
cp deploy/sumeru.service ~/.config/systemd/user/
# 或使用符号链接（开发时方便更新）:
# ln -s $(pwd)/deploy/sumeru.service ~/.config/systemd/user/

# 2. 配置 adapter 认证（仅当用 claude-code / codex / cursor-agent 等 CLI adapter）
#    systemd user service 不继承 login shell 环境，凭证必须显式提供。
mkdir -p ~/.config/sumeru
cp deploy/sumeru.env.example ~/.config/sumeru/env
chmod 600 ~/.config/sumeru/env          # 仅 owner 可读，保护密钥
$EDITOR ~/.config/sumeru/env            # 填入真实 ANTHROPIC_API_KEY 等
#    只用 hermes adapter 的节点可跳过这步（unit 里 EnvironmentFile 标了可选）。

# 3. 重载 systemd
systemctl --user daemon-reload

# 4. 启用并启动服务
systemctl --user enable --now sumeru
```

> **PATH 与认证**：CLI-based adapter（claude-code / codex / cursor-agent）会 spawn
> 外部二进制并需要 API key，但 systemd user service **不继承 login shell 环境**。
> unit 模板已用 `Environment=PATH=...` 声明 npm/local bin（否则 `spawn claude` →
> `ENOENT`），并用 `EnvironmentFile=` 读取上面那个 0600 env 文件提供认证（否则
> claude 回 `Not logged in`）。凭证只放在 `~/.config/sumeru/env`，**不进 git**；
> repo 里只有占位的 `deploy/sumeru.env.example`。

### 查看日志

```bash
journalctl --user -u sumeru -f
```

### 重启服务

```bash
systemctl --user restart sumeru
```

### 查看状态

```bash
systemctl --user status sumeru
```

### macOS：launchd LaunchAgent

macOS 没有 systemd，用 launchd LaunchAgent 跑同等服务。因为 launchd 没有
`EnvironmentFile=` 指令、且不继承 login shell 环境，而 Sumeru 会 spawn 外部
adapter 二进制（需要 PATH，claude-code 还需 `ANTHROPIC_*`），所以这套是
**plist + wrapper 脚本 + 0600 env 文件** 三件套（wrapper 负责设 PATH、加载凭证后
exec sumeru，等价于 systemd 的 `EnvironmentFile=`）。

```bash
# 1. 安装 wrapper 脚本（设 PATH + 加载凭证 + exec sumeru）
mkdir -p ~/.config/sumeru
cp deploy/sumeru-launchd-run.sh.example ~/.config/sumeru/launchd-run.sh
chmod 755 ~/.config/sumeru/launchd-run.sh

# 2. 放置实例配置
$EDITOR ~/.config/sumeru/sumeru.yaml     # name + gateways

# 3. 配置 adapter 认证（仅当用 claude-code 等 CLI adapter）
cp deploy/sumeru.env.example ~/.config/sumeru/env
chmod 600 ~/.config/sumeru/env           # 仅 owner 可读
$EDITOR ~/.config/sumeru/env             # 填入真实 ANTHROPIC_API_KEY 等
#    只用 hermes adapter 的节点可跳过这步（hermes 从 ~/.hermes/config.yaml 读凭证，不靠环境变量）。

# 4. 安装 LaunchAgent，并把 plist 里所有 __HOME__ 替换为绝对 home（launchd 不展开 ~ / $HOME）
sed "s|__HOME__|$HOME|g" deploy/sumeru.plist.example > ~/Library/LaunchAgents/work.shazhou.sumeru.plist

# 5. 加载并启动
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/work.shazhou.sumeru.plist
launchctl kickstart -k gui/$(id -u)/work.shazhou.sumeru
```

> **PATH 与认证**：与 systemd 同理 —— launchd 给的环境极精简。wrapper 脚本里用
> `export PATH=...` 声明 homebrew / pnpm / local bin（否则 `spawn claude` →
> `ENOENT`），并 source `~/.config/sumeru/env` 提供 `ANTHROPIC_*`。凭证只放在
> `~/.config/sumeru/env`（0600，**不进 git**），repo 里只有占位的
> `deploy/sumeru.env.example`（systemd / launchd 共享同一份格式）。

管理命令：

```bash
launchctl print   gui/$(id -u)/work.shazhou.sumeru   # 状态 / pid / 上次退出码
launchctl kickstart -k gui/$(id -u)/work.shazhou.sumeru   # 重启
launchctl bootout gui/$(id -u)/work.shazhou.sumeru   # 停止 + 卸载
tail -f ~/.config/sumeru/sumeru.log                  # 日志（launchd 无 journald）
```

> 迁移提示：切到 launchd 前先停掉手动起的 `sumeru`（释放 7900），否则 pid 文件
> （`~/.sumeru/sumeru.pid`）单实例锁会让 launchd 实例因端口占用 crash-loop。

### 为什么是独立 service

以前 Sumeru 作为 hermes-gateway 的子进程运行，gateway 重启时 systemd 会杀掉整个
进程树 —— Sumeru 连带阵亡。改为独立 user service 后，Sumeru 有自己的进程树，
gateway 重启对它毫无影响。

### Docker 模式

Sumeru 以 npm 包分发，Docker 模式**不依赖源码仓库**：`pnpm add -g @sumeru/cli`
拿到 `sumeru` 命令即可。部署后端写进 `sumeru.yaml` 自身的 `deploy:` 块——
**一份 config = 一个工作单元**，`name` 即实例名 / compose project / volume 前缀。

```yaml
name: alpha                  # 工作单元身份
workspaceRoot: /workspace

deploy:                      # 可选；缺省 = 本机模式（零回归）
  mode: docker               # docker | local（默认 local）
  port: 7901                 # 宿主机端口（容器内固定 7900）
  workspace: ~/units/alpha   # 宿主机目录 → bind-mount 到 /workspace
  image: sumeru:latest       # 可选镜像 tag

gateways:
  hermes:
    adapter: hermes
    capabilities: { resume: true, streaming: true }
```

写好 config 后，一条命令拉起容器：

```bash
sumeru start -c alpha.yaml
```

`sumeru start` 读 `deploy.mode`——`docker` 走 `docker compose -p <name> up -d --build`
真起容器，`local`/缺省落本机模式（零回归）。`deploy:` 块**只由 CLI 读、server 忽略**
——容器内 server 看到的 config 与本机模式字节一致，API 对等契约不破。编排产物
（`Dockerfile` / `docker-compose.yaml` / `sumeru.env.example`）随 `@sumeru/server`
包发布，由 CLI 在工作目录**原样释放**（零渲染——所有可变量走 compose 原生
`${VAR:-default}` 插值），所以整条链路无需源码仓库。

两条面向运维的保证：

- **持久化**：ocas 落 named volume `<name>_sumeru-ocas`，`docker compose -p <name> down`
  （不带 `-v`）**保留数据**，只有 `down -v` 才清除——重启即可召回旧 session。
- **工作单元隔离**：**一份 config = 一个工作单元**，`name` 即身份（实例名 / compose
  project / volume 前缀）；多份 config（`alpha.yaml` / `beta.yaml`）= 多个 volume / 端口 /
  session 互不可见的独立单元，隔离仅源于 config 身份，无需额外编排。

> Docker 模式分三期落地：**Phase 1**（#84）`deploy:` 块解析 + 随包发布的模板 +
> `materializeDockerAssets`；**Phase 2**（#85）`sumeru start` 按 `deploy.mode` 拉起
> 容器 + `--emit-assets` + 无 Docker 降级；**Phase 3**（#86）门控集成测试锁死隔离 /
> 持久化 / 降级三契约。设计详见
> [specs/architecture/docker-mode.md](specs/architecture/docker-mode.md)。

## Name

> 须弥山 — 佛教宇宙观中的世界中心。一粒芥子里装一座须弥山 — 一个小小的 HTTP 服务里，容纳了整个 agent 世界。
