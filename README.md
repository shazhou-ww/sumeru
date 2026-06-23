# Sumeru 🏔️

> 芥子纳须弥 — 一粒芥子里装一座须弥山

**Agent house** — 一个 HTTP 服务，为同一运行环境内的多个 agent 提供统一的收发室，所有交互通过 ocas 全量记录。

## 核心概念

```
Instance (一个进程，一个 endpoint)
  │
  ├─ Gateway: hermes (adapter = @sumeru/adapter-hermes)
  │    ├─ Session ses_01JXYZ → native: hermes session 20260614_053637_b3a39f
  │    └─ Session ses_01JXZZ → native: hermes session 20260614_053701_1f1583
  │
  └─ Gateway: claude-code (adapter = @sumeru/adapter-claude-code)
       └─ Session ses_01JY00 → native: claude session xyz
```

- **Instance** — 一个 Sumeru 进程，一个运行环境的 agent 管理层，对外暴露一个 HTTP endpoint
- **Gateway** — Instance 内的一个 agent 入口，由 adapter 驱动，配置声明 capabilities
- **Session** — 一次 agent 对话，`ses_` + ULID，支持 resume（多次 message 延续同一 conversation）
- **Adapter** — 每类 agent 一个包，实现 `createSession` / `send` / `close` / `getTurns`

## Quick Start

```bash
# 1. 创建实例配置
cat > sumeru.yaml << 'EOF'
name: sumeru@local

gateways:
  hermes:
    adapter: hermes
    capabilities:
      resume: true
      streaming: true
EOF

# 2. 启动服务
sumeru start -c sumeru.yaml -p 7900

# 3. 验证
curl http://127.0.0.1:7900/
# → {"type":"@sumeru/instance","value":{"name":"sumeru@local","version":"0.1.0","gateways":["hermes"]}}
```

## HTTP API

所有响应使用 ocas envelope 格式 `{ type, value }`。

### 实例信息

```
GET /  → @sumeru/instance
```

### Gateway

```
GET /gateways           → @sumeru/gateways (列出所有 gateway)
GET /gateways/:name     → @sumeru/gateway  (单个 gateway 详情)
```

### Session

```
POST   /gateways/:name/sessions          → 201 @sumeru/session (创建)
GET    /gateways/:name/sessions/:id      → @sumeru/session     (查看)
GET    /gateways/:name/sessions/:id/messages → @sumeru/message-history (历史)
DELETE /gateways/:name/sessions/:id      → 204                 (关闭)
```

### 发消息 (SSE)

```
POST /gateways/:name/sessions/:id/messages  → text/event-stream
```

请求 body: `{ "content": "你的消息" }`

SSE 事件流：
- `event: turn` — 完整的 Turn 对象 `{ index, role, content, timestamp, hash }`
- `event: heartbeat` — 保活
- `event: done` — 完成，附带 summary `{ turnCount, tokens, durationMs }`
- `event: error` — 错误

支持 `Last-Event-ID` header 断点续传。

### 搜索 & 导出

```
GET  /sessions?q=keyword&gateway=hermes  → FTS5 全文搜索
POST /gateways/:name/sessions/:id/export → tar.gz 导出
```

### 持久化 & 重启

所有 turn 内容、session-meta，以及每个 session 的 **有序 turn 列表指针** 都落在
`<ocasDir>/_store.db`（与 FTS5 索引同库）。server 重启后 `createSessionStore`
会从盘上 rehydrate：之前记录过的 session 重新可见，`GET .../messages` 返回的历史
与重启前完全一致（相同 total、相同 hash、相同顺序）。

注意：adapter 侧的 `NativeSessionRef` 是运行时状态、不落盘——rehydrate 出来的
session 历史可读但不可继续发新消息，`POST .../messages` 会返回
`503 adapter_unavailable`。已关闭的 session 重启后仍为 `closed`；idle/active 统一
恢复为 `idle`（重启不可能让一次发送悬在半途）。

## Packages

| Package | Description |
|---------|-------------|
| `@sumeru/core` | Core type definitions (Adapter, Turn, Session types) |
| `@sumeru/server` | HTTP service (Instance, Gateway, Session management) |
| `@sumeru/adapter-hermes` | Adapter for Hermes Agent |
| `@sumeru/adapter-claude-code` | Adapter for Claude Code CLI |
| `@sumeru/adapter-cursor-agent` | Adapter for Cursor Agent CLI |
| `@sumeru/cli` | CLI tool (`sumeru start`) |

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

Sumeru 以 **systemd user service** 运行，与 `hermes-gateway.service` 完全解耦。
gateway 重启不再影响 Sumeru。

### 安装服务

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
