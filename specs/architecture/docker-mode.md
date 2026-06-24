---
scenario: "Docker 模式：在一个 Docker 容器内运行 Sumeru + agent，对外暴露与本机模式完全一致的 HTTP endpoint；ocas 存储挂载到 volume，工作目录 bind-mount 进容器，容器销毁后数据可保留。镜像与编排产物自包含、不依赖 Sumeru 源码仓库。部署后端由 sumeru.yaml 的 deploy 块声明，一份 config = 一个独立工作单元"
feature: docker-mode
tags: [docker, deployment, container, isolation, api-parity, ocas, volume, self-contained, work-unit, phase-7]
---

## Given

- `specs/architecture/architecture.md` → 「部署模式 → Docker 模式」(L400-407) 声明：
  > 启动一个 Docker 容器，容器内跑 Sumeru + agent。用于：隔离实验、观察研究、不信任的 agent。
  > 对外仍然是一个 Sumeru endpoint，跟本机模式没区别。
- 宿主机已安装 Docker（`docker` / `docker compose` 可用，版本 ≥ 20.10，Compose v2）。Docker 不可用时，本 spec 不适用（错误处理见下文「宿主机无 Docker」）。
- **Sumeru 以 npm 包分发，不假设宿主机存在源码仓库。** 操作者通过 `pnpm add -g @sumeru/cli` 获得 `sumeru` 命令即可使用 Docker 模式；无需 `git clone`、无需本地 `pnpm run build`、无需仓库里的 `packages/*/dist`。

### 核心模型：一份 config = 一个工作单元

部署后端（本机 / 容器）、容器端口、宿主机工作目录、ocas 存储位置等**全部由 `sumeru.yaml` 自身声明**。操作者只需 `sumeru start -c <config>` 一个参数，CLI 据 config 决定如何启动。

- **`name` 是工作单元的身份**：既是实例名（`GET /` 返回的 `name`），也是 compose **project 名**，也是 named volume 的前缀（`<name>_sumeru-ocas`）。身份由 config 显式携带，**不依赖 CWD / 目录名**——在任意目录 `sumeru start -c alpha.yaml` 都得到同一个 `alpha` 单元，位置无关、可复现。
- **多实例并存 = 多份 config**：`alpha.yaml` / `beta.yaml` 各有独立的 `name` → 各自独立的 project / volume / port / workspace，互不干扰。这就是「多 docker」的实现方式——不需要任何额外编排机制，靠 config 身份隔离。
- **`deploy:` 块由 CLI 读、server 忽略**：见下文「config deploy 块契约」。server 的 `loadConfig` 只解析 `name` / `workspaceRoot` / `gateways`（其运行时所需），`deploy` 作为 unknown key 被既有 forward-compat 逻辑（`config.ts`「Unknown keys ... tolerated」）忽略。**职责不串味**：容器内跑的 server 看到的 config 与本机模式字节一致，API 对等契约不破。

> **为什么部署信息进 config、而非 flag**：旧设计用 `--docker` flag + 一堆 `--port/--workspace` 透传，且实例身份靠 CWD（脆弱）。重定向为「config 即单一信源」：部署后端写进 `deploy.mode`，工作单元身份写进 `name`，`sumeru start -c x.yaml` 一行启动。统一入口、无隐式状态、多实例天然。

### config deploy 块契约

`sumeru.yaml` 顶层新增**可选** `deploy:` 块。缺省时 `sumeru start` 走本机模式（保持 `server-start-listens.md` 既有行为，零回归）。

```yaml
name: alpha                    # 工作单元身份 → 实例名 / compose project / volume 前缀
workspaceRoot: /workspace      # 容器内 cwd 解析根（见 config-load-workspace-root.md）

deploy:                        # 可选；缺省 = 本机模式
  mode: docker                 # docker | local（默认 local）
  port: 7901                   # 宿主机映射端口（容器内固定 7900）
  workspace: ~/units/alpha     # 宿主机工作目录 → bind-mount 到容器 /workspace
  image: sumeru:latest         # 可选；缺省构建/使用 sumeru:latest
  # ocas volume 名自动 = <name>_sumeru-ocas，无需声明

gateways:
  hermes:
    adapter: hermes
    capabilities: { resume: true, streaming: true }
```

- `deploy.mode`: `docker` | `local`。缺省 `local`。
- `deploy.port`: 宿主机端口，映射到容器内固定 `7900`。缺省 `7900`。
- `deploy.workspace`: 宿主机目录，bind-mount 到容器 `/workspace`（host 可见，agent 产物落宿主机此目录）。缺省为 config 文件所在目录。
- `deploy.image`: 可选镜像 tag。缺省 `sumeru:latest`（由 compose 模板的 `build` 段构建）。
- **server 不读 `deploy`**：该块是 CLI 的部署清单，server 的 `loadConfig` 忽略它。

### 产物归属与自包含原则

Docker 模式的编排产物（**镜像构建定义** + **compose 模板**）**随 `@sumeru/server` 包发布**，不归属 `@sumeru/cli`（cli 是依赖 server 的薄入口，不承担运行时编排职责），也不归属 `@sumeru/core`（纯类型）。

- 模板源在 `packages/server/templates/docker/`：
  - `packages/server/templates/docker/Dockerfile` — 构建 Sumeru 运行镜像。
  - `packages/server/templates/docker/docker-compose.yaml` — 声明式一键启动模板。
  - `packages/server/templates/docker/sumeru.env.example` — adapter 凭据模板（对应 `deploy/sumeru.env.example` 的 Docker 版）。
- `@sumeru/server` 的 `package.json` `files` 字段包含 `"templates"`，使上述产物随 npm 发布进包。
- `@sumeru/server` 导出 `materializeDockerAssets(targetDir): string[]`：把模板**原样拷贝**到 `targetDir`（不做字符串渲染——所有可变量走 compose 原生 `${VAR:-default}` 环境变量插值），返回写出的文件路径列表。这是 `sumeru start`（容器模式，When-2）与手动使用（When-1）共同的产物来源。

> **为什么不 COPY 源码、不绑仓库根**：旧设计假设「操作者在 Sumeru 源码仓库根目录构建并启动」，与「`pnpm add -g` 全局安装、宿主机无源码」的真实分发方式冲突。本 spec 重定向为：镜像通过 `pnpm add -g @sumeru/cli@<version>` 从 npm 自包含安装；compose/Dockerfile 由 CLI 释放到工作目录。Docker 模式因此独立于源码项目。

- 本机模式的 HTTP 契约（见 architecture.md「HTTP API」）已稳定并作为对照基线：
  `GET /`、`GET /gateways`、`POST /gateways/:name/sessions`、`POST .../messages`、`GET .../messages`、`DELETE .../sessions/:id`、`GET /ocas/:hash`、`POST .../export`。

### 镜像内容契约

`Dockerfile` 构建的镜像（tag：`sumeru:latest`，后续称 **the image**）满足：

| 维度 | 内容 |
|------|------|
| Base | `node:22-slim`（与本项目 Runtime：Node.js 22 一致）|
| Sumeru | **`RUN pnpm add -g @sumeru/cli@<version>` 从 npm 全局安装**（自动拉取 `@sumeru/server` + 各 adapter + core 全套依赖）；入口为全局 `sumeru` 命令。镜像**不 COPY 源码树、不依赖仓库 `packages/*/dist`** |
| 版本钉死 | 镜像构建参数 `ARG SUMERU_VERSION`，默认 `latest`；CI/发布时传入确定版本号，保证镜像可复现 |
| Agent 二进制 | 至少一个 adapter 对应的可执行文件位于 `PATH`：`hermes` / `claude` / `cursor-agent` / `codex`。缺哪个 adapter，对应 gateway 启动后报 `status: "unavailable"`（与 `cli-pass-gateway-config.md` 既有契约一致），**不致命** |
| 网络 | 容器默认 bridge 网络，可出站访问外网（agent 调用上游模型 API 所必需）|
| 基础工具 | `git`、`node`、`npm`/`pnpm`、`curl`（healthcheck 探针）预装 |
| 地基层工具链 | **`build-essential`**（native 扩展源码编译，如 numpy/lxml/cffi）、**`uv`**（Python 多版本 + venv + 装包，默认 **Python 3.12**）、**`nvm`**（Node 多版本，给 agent 跑用户项目用，装于共享 `/usr/local/nvm`，默认 **Node 24 LTS**）。均**构建期 root** 装；运行期 agent 以非 root 自由切版本、装 py/node 包、编译 native 扩展，无需 supervisor 介入。详见 `specs/deploy/docker-toolchain-baseline.md`（RFC #99 P0）|
| 版本/包二分 | 镜像固化**工具链 + 默认版本**（可复现）；具体**包**交给 agent 运行期自由装，落沙箱私有层。server 自身的 node 锁定在 `pnpm add -g @sumeru/cli` 那套地基（独立于 nvm 的动态层 node）|
| 端口 | EXPOSE `7900`（与 `server-start-listens.md` 默认端口一致）|
| 非 root | 以非 root 用户 `sumeru` 运行（uid 固定 10001，便于宿主机 volume 权限对齐）。地基层工具链全部构建期 root 安装，运行期 uid 10001 不变 |

镜像本身**不含**任何凭据、任务 prompt 或用户数据 —— 这些全部运行期注入。

### 存储与目录映射契约

CLI 释放 compose 模板到工作目录后，把 config 的 `name` / `deploy.*` 映射为 compose 环境变量（`SUMERU_PROJECT` / `SUMERU_PORT` / `WORKSPACE` 等）。所有 bind-mount 相对路径以 compose 文件所在目录为基准（Compose v2 语义），与 config / env 文件同处一地，路径基准统一，不存在「仓库根 vs 子目录」分裂。

- **工作单元隔离** → compose `-p <name>`（project 名 = config 的 `name`），named volume 自动带 project 前缀 `<name>_sumeru-ocas`。多单元各自独立，**身份来自 config 而非目录**。
- **ocas 存储** → named volume `sumeru-ocas`（实名 `<name>_sumeru-ocas`），挂载到容器内 `/data/ocas`。容器内 Sumeru 以 `SUMERU_OCAS_DIR=/data/ocas` 启动（见 `server-ocas-store-bootstrap.md` 契约）。
- **工作目录** → `deploy.workspace`（宿主机目录）bind-mount 进容器内 `/workspace`，映射为 compose `WORKSPACE` 变量。`sumeru.yaml` 的 `workspaceRoot: /workspace` 固定指向此路径（见 `config-load-workspace-root.md`）。
- **配置文件** → config 文件只读挂载到 `/app/sumeru.yaml`（compose 中 `read_only: true`）。运行期不允许容器改写自身配置。
- **凭据文件** → 工作目录的 `sumeru.env` 经 compose `env_file`（`required: false`）注入；不存在时不致命（仅用 hermes 的节点无需凭据）。

## When

### When-1：声明式一键启动（compose，手动）

- 操作者运行 `sumeru start -c <config> --emit-assets`（或等价的 `materializeDockerAssets`）把 `Dockerfile` / `docker-compose.yaml` / `sumeru.env.example` 释放到工作目录，并备好 config（含 `deploy:` 块）。
- 操作者**从该目录**运行：
  ```
  docker compose -p <name> up -d --build      # project 名 = config 的 name
  ```
- `docker-compose.yaml` 声明：
  - `build` 指向同目录 `Dockerfile`（带 `args: SUMERU_VERSION`），或 `image: ${SUMERU_IMAGE:-sumeru:latest}`
  - `ports: ["${SUMERU_PORT:-7900}:7900"]`（宿主机端口由 `deploy.port` 映射）
  - `volumes`：
    - `sumeru-ocas:/data/ocas`（named volume，实名 `<name>_sumeru-ocas`）
    - `${WORKSPACE:-.}:/workspace`（bind mount，由 `deploy.workspace` 映射）
    - `${SUMERU_CONFIG:-./sumeru.yaml}:/app/sumeru.yaml:ro`（配置，只读）
  - `env_file`：`{ path: ./sumeru.env, required: false }`（凭据）
  - `environment`：透传 `SUMERU_OCAS_DIR=/data/ocas`、`HOME=/home/sumeru`
  - `restart: unless-stopped`
  - `healthcheck`：每 10s `curl -fsS http://127.0.0.1:7900/`（`GET /` 返回 200 即健康）

### When-2：CLI 一键启动（config 驱动，统一入口）

- 操作者运行 `sumeru start -c <config>`。**无 `--docker` flag** —— 部署后端由 config 的 `deploy.mode` 决定：
  - `deploy` 缺省 或 `deploy.mode: local` → 本机模式（既有行为，零回归）。
  - `deploy.mode: docker` → 容器模式，CLI 自动：
    1. 调 `@sumeru/server` 的 `materializeDockerAssets` 把模板释放到工作目录（若已存在则复用，不覆盖用户改动）。
    2. 把 config 的 `name` / `deploy.port` / `deploy.workspace` / `deploy.image` 映射为 `SUMERU_PROJECT`(=name) / `SUMERU_PORT` / `WORKSPACE` / `SUMERU_IMAGE` 等环境变量，执行 `docker compose -p <name> up -d --build`（compose 文件即释放出的那份），**不重复实现 Docker 编排逻辑**。出错时原样透传 compose 的 stderr。
- 例（多工作单元并存）：
  ```
  sumeru start -c alpha.yaml     # deploy.mode:docker, name:alpha → project alpha, volume alpha_sumeru-ocas, port 7901
  sumeru start -c beta.yaml      # deploy.mode:docker, name:beta  → project beta,  volume beta_sumeru-ocas,  port 7902
  sumeru start -c local.yaml     # deploy 缺省 → 本机进程模式
  ```
- **仅释放产物、不启动**：`sumeru start -c <config> --emit-assets` 只调 `materializeDockerAssets` 释放产物后退出（供 When-1 手动 compose），不执行 `docker compose up`。
- **无源码依赖**：整个流程不读取任何 Sumeru 源码仓库文件，产物全部来自 `@sumeru/server` 包内模板。

### When-3：API 对等探测

- 容器 `up` 且 `healthcheck` 为 healthy 后，操作者从宿主机对每一个 architecture.md 列出的端点发起请求（基线对照：同一份 `sumeru.yaml` 在本机模式 `sumeru start` 下跑出相同响应）。

### When-4：数据持久化

- 容器跑出若干 turn 后，操作者 `docker compose -p <name> down`（销毁容器，**不**带 `-v`）。

### When-5：失败与降级

- 操作者在未安装 Docker 的机器上对一份 `deploy.mode: docker` 的 config 运行 `sumeru start -c <config>`。

## Then

### Then-1：镜像构建产物正确，且自包含

- `docker compose -p <name> build`（或 `docker build -t sumeru:latest -f Dockerfile .`）退出码 0。
- `docker run --rm sumeru:latest node --version` 输出 `v24.*`（nvm 管理的默认 Node 24 LTS——地基层工具链 issue #102 把默认 Node 24 的 bin 前置进基础 `PATH`，故裸的非登录 `node` 命中 v24，而非 `node:22-slim` 基础解释器；基础镜像仍 `FROM node:22-slim`，server 自身经 node:sqlite 内置驱动在 v24 下正常运行）。
- `docker run --rm sumeru:latest sh -lc 'command -v git && command -v node && command -v sumeru'` 三者都打印绝对路径（`sumeru` 来自全局安装）。
- **自包含验证**：构建上下文中**无** Sumeru 源码（`Dockerfile` 不出现 `COPY packages`）；镜像内 `sumeru` 命令来自 `pnpm add -g @sumeru/cli`，`npm ls -g @sumeru/cli` 在容器内列出确定版本。
- 缺失某个 adapter 二进制时镜像**仍然构建成功**（adapter 二进制是运行期 spawn 的依赖，构建期不校验存在性）。

### Then-2：容器启动后对外是标准 Sumeru endpoint

- `sumeru start -c <config>`（docker 模式）后，宿主机 `curl -fsS http://127.0.0.1:<deploy.port>/` 返回 HTTP `200`，body 为 `@sumeru/instance` envelope（`{ type, value: { name, version, gateways } }`），`name` 即 config 的 `name`，与本机模式字节同构。
- 容器 stdout 出现本机模式同款启动行 `Listening on http://0.0.0.0:7900`（容器内 `--host 0.0.0.0`，对外端口由 compose 映射）。
- `[sumeru] ocas store: /data/ocas` 日志出现一次（与 `server-ocas-store-bootstrap.md` 契约一致），证明 ocas 落在 volume 上而非容器可写层。
- **缺二进制的 gateway 降级**：若 `sumeru.yaml` 声明了 `claude-code` 但镜像里没有 `claude`，`GET /gateways` 仍返回 200，该项 `status: "unavailable"`；不影响其他已就绪 gateway。
- **多单元隔离验证**：同时起 `alpha` 与 `beta` 两单元，`docker volume ls` 列出 `alpha_sumeru-ocas` 与 `beta_sumeru-ocas` 两个独立卷；两实例端口不同、session 数据互不可见。

### Then-3：API 对等（核心契约）

> Docker 模式与本机模式对外 HTTP 契约**完全一致**。差异仅限「传输（宿主机端口 → 容器端口）」与「存储位置（volume）」两点。

逐端点验证（同输入、同 `sumeru.yaml`）：

| 端点 | 行为 | 与本机模式差异 |
|------|------|----------------|
| `GET /` | 返回 `@sumeru/instance` | 无（`name`/`version`/`gateways` 字段同源）|
| `GET /gateways` | 返回 `@sumeru/gateway-list` | 无 |
| `GET /gateways/:name` | 返回 gateway 详情 / 404 `gateway_not_found` | 无 |
| `POST /gateways/:name/sessions` | 201 + `@sumeru/session`；`config` opaque 透传 | 无 |
| `POST .../messages` | SSE turn/heartbeat/done 流；`X-Accel-Buffering: no`（与 `server-message-sse-endpoint.md` 一致，**反向代理友好**）| 无 |
| `GET .../messages` | 消息历史分页 | 无 |
| `DELETE .../sessions/:id` | 204，关闭后历史仍可读 | 无 |
| `GET /ocas/:hash` | 返回 ocas envelope | 无 |
| `POST .../export` | 200 + `application/gzip` tar.gz | 无（导出走容器内 ocas store，底层即 volume）|
| 错误格式 | `@sumeru/error` envelope，状态码 400/404/409/502/504 | 无 |

- **反向代理透明**：因 SSE 已带 `X-Accel-Buffering: no`，即便宿主机在 compose 之外再套一层 nginx，turn 流不被代理缓冲掐断。
- **Session cwd 解析**：session 的 `config.cwd`（相对）按 `workspaceRoot: /workspace` 解析（见 `server-session-resolve-cwd.md`），落在 bind-mount 的宿主机目录内 —— agent 看到的是宿主机工作目录的同一份文件。

### Then-4：ocas 数据跨容器生命周期保留

- `docker compose -p <name> down`（不带 `-v`）后，`docker volume ls | grep <name>_sumeru-ocas` 仍列出该 named volume。
- 重新 `sumeru start -c <config>` 后：
  - `GET /gateways/:name/sessions?q=<旧 task 关键词>` 能召回旧 session（ocas 内容寻址，重启幂等）。
  - 对旧 session id `GET .../sessions/:id` 返回原 recording（turn 列表、token、toolCalls 完整）。
  - `POST .../export` 导出的 tar.gz 与销毁前导出的字节同构（ocas 内容寻址决定，见 `server-session-export-endpoint.md` 的 Determinism 契约）。
- 只有显式 `docker compose -p <name> down -v`（删 volume）才真正清除数据。`-v` 行为由 Docker 原生提供，本 spec 不改写。

### Then-5：凭据与隔离语义

- **凭据注入**：adapter 凭据（如 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`，见 `deploy-systemd-service-unit.md` Notes）经工作目录的 `sumeru.env`（chmod 600，**不**提交仓库；模板只发 `sumeru.env.example`）+ compose `env_file`（`required: false`）注入容器。未配置凭据的 adapter 启动不致命（gateway `unavailable`，见 Then-2）。
- **隔离边界**：agent 在容器内 `apt install`、写 `/etc`、`rm -rf` 等动作**不触及宿主机根文件系统**，仅影响容器可写层与 `/workspace` bind mount。`/workspace`（= `deploy.workspace`）是唯一双向共享面，agent 在此目录的写操作对宿主机可见 —— 这是设计意图（agent 的工作产物需可见），不算隔离失效。
- **网络出站**：容器可出站访问上游模型 API（bridge 默认 NAT）。需要更严网络隔离时，操作者改写 compose `networks` 或加 `network_mode` —— 本 spec 不规定默认值，留给运维层。

### Then-6：宿主机无 Docker

- `sumeru start -c <config>`（`deploy.mode: docker`）检测到 `docker` 不在 `PATH`（或 `docker info` 非 0 退出）时：
  - 退出码 `1`，stderr 单行：`Docker is not available. Install Docker or set deploy.mode: local in your config.`
  - **不**打印 stack trace，不尝试任何 fallback。

### Tests（gated on Docker）

- 测试目录 `packages/cli/tests/docker-mode.test.ts`（或 `packages/server/tests/`），全部以 `SUMERU_DOCKER_INTEGRATION=1` 门控，无 Docker 时整体 skip，**不**算失败。
  - **config deploy 块**：`loadConfig` 读一份带 `deploy:` 的 config，断言 server 侧 `InstanceConfig` 只含 `name`/`workspaceRoot`/`gateways`（`deploy` 被忽略，不进 server 运行时）；CLI 侧解析出 `deploy.mode`/`port`/`workspace`。
  - **模板释放**：`materializeDockerAssets(tmpDir)` 写出三个产物，断言 `docker compose -f <tmpDir>/docker-compose.yaml config` 退出 0，解析出的 `source` 路径基准为 `tmpDir`、无错位。
  - **构建（自包含）**：从释放目录 `docker compose build` 成功；`node --version` 命中 22；构建上下文无源码 COPY。
  - **启动 + 健康检查**：`sumeru start -c <docker-config>` → 轮询 `GET /` 直到 200（最多 30s）→ 断言 `@sumeru/instance` envelope 形状，`name` 匹配 config。
  - **往返**：`POST sessions` → `POST .../messages`（stubbed 或真实 agent，二选一）→ 断言 SSE 出现至少一个 `event: turn` + 一个 `event: done`。
  - **持久化**：跑出 turn → `compose -p <name> down`（无 `-v`）→ 重启 → 旧 session id 仍 `GET` 得到，turn 数不变。
  - **多单元隔离**：起 `alpha` + `beta` 两 config，断言两 volume 独立、session 互不可见。
  - **导出**：`POST .../export` → 200 + `application/gzip`；解压后含 `cas/*.bin`。
  - **降级**：用一份声明了不存在 adapter 的 config，断言 `GET /gateways` 对应项 `unavailable` 且其他项不受影响。
  - **无 Docker**：临时从 `PATH` 移除 `docker`，对 `deploy.mode: docker` 的 config 运行 `sumeru start`，断言退出码 1 + 文档化错误信息。
- 所有既有（非 Docker）测试继续原样通过。

### Documentation

- `README.md` 部署章节新增「Docker 模式」小节：3–6 行，给出 `pnpm add -g @sumeru/cli` → 写 `deploy.mode: docker` 的 config → `sumeru start -c <config>` 的零源码路径，与「ocas 落 volume、`down` 不丢数据、`-v` 才清除」「多 config = 多工作单元」两点。
- 链回 architecture.md「部署模式 → Docker 模式」与本 spec。

## Non-goals

- **不**做 Kubernetes / 远程编排（Docker Compose + 单机即覆盖隔离实验场景；K8s 是另一层）。
- **不**做多容器水平扩缩（一个工作单元 = 一个 Sumeru 实例 = 一个 endpoint；要多个就多份 config）。
- **不**做镜像签名 / 镜像扫描（信任来自 npm 发布链 + 仓库构建链，超出本 spec）。
- **不**规定 agent 二进制版本固定策略（版本钉死由 adapter 包 / CI 处理；镜像构建期读取 lockfile）。
- **不**引入模板渲染引擎（compose 模板原样拷贝，所有可变量走 compose 原生 `${VAR:-default}` 环境变量插值；CLI 零渲染逻辑）。
- **不**保留 `--docker` flag（部署后端是 config 的单一信源 `deploy.mode`；不引入 flag 与 config 的双信源歧义）。
- **不**实现 `sumeru run <scene>` 的一次性实验流程 —— 那是 `specs/cli/sumeru-run-scene.md` 的职责，本 spec 只提供**它复用的基础设施**（镜像 + volume + compose + API 对等）。
