---
scenario: "Docker 模式：在一个 Docker 容器内运行 Sumeru + agent，对外暴露与本机模式完全一致的 HTTP endpoint；ocas 存储挂载到 volume，工作目录 bind-mount 进容器，容器销毁后数据可保留"
feature: docker-mode
tags: [docker, deployment, container, isolation, api-parity, ocas, volume, phase-7]
---

## Given

- `specs/architecture/architecture.md` → 「部署模式 → Docker 模式」(L400-407) 声明：
  > 启动一个 Docker 容器，容器内跑 Sumeru + agent。用于：隔离实验、观察研究、不信任的 agent。
  > 对外仍然是一个 Sumeru endpoint，跟本机模式没区别。
- 宿主机已安装 Docker（`docker` / `docker compose` 可用，版本 ≥ 20.10）。Docker 不可用时，本 spec 不适用（错误处理见下文「宿主机无 Docker」）。
- 仓库已 `pnpm run build` 通过，`packages/cli/dist/cli.js` 存在。
- 仓库新增一个 `docker/` 目录，包含三个产物：
  - `docker/Dockerfile` — 构建 Sumeru 运行镜像。
  - `docker/docker-compose.yaml` — 声明式一键启动。
  - `docker/sumeru.env.example` — adapter 凭据模板（对应 `deploy/sumeru.env.example` 的 Docker 版）。
- 本机模式的 HTTP 契约（见 architecture.md「HTTP API」）已稳定并作为对照基线：
  `GET /`、`GET /gateways`、`POST /gateways/:name/sessions`、`POST .../messages`、`GET .../messages`、`DELETE .../sessions/:id`、`GET /ocas/:hash`、`POST .../export`。

### 镜像内容契约

`docker/Dockerfile` 构建的镜像（tag：`sumeru:latest`，后续称 **the image**）满足：

| 维度 | 内容 |
|------|------|
| Base | `node:22-slim`（与本项目 Runtime：Node.js 22 一致）|
| Sumeru | 仓库 `packages/*/dist/` 全量 COPY 进 `/app`；入口 `node packages/cli/dist/cli.js` |
| Agent 二进制 | 至少一个 adapter 对应的可执行文件位于 `PATH`：`hermes` / `claude` / `cursor-agent` / `codex`。缺哪个 adapter，对应 gateway 启动后报 `status: "unavailable"`（与 `cli-pass-gateway-config.md` 既有契约一致），**不致命** |
| 网络 | 容器默认 bridge 网络，可出站访问外网（agent 调用上游模型 API 所必需）|
| 基础工具 | `git`、`node`、`npm`/`pnpm` 预装（适配器 spawn、agent 工作目录所需）|
| 端口 | EXPOSE `7900`（与 `server-start-listens.md` 默认端口一致）|
| 非 root | 以非 root 用户 `sumeru` 运行（uid 固定，便于宿主机 volume 权限对齐）|

镜像本身**不含**任何凭据、任务 prompt 或用户数据 —— 这些全部运行期注入。

### 存储与目录映射契约

- **ocas 存储** → named volume `sumeru-ocas`，挂载到容器内 `/data/ocas`。容器内 Sumeru 以 `--ocas-dir /data/ocas` 启动（见 `server-ocas-store-bootstrap.md` 的 `--ocas-dir` / `SUMERU_OCAS_DIR` 契约）。该路径即架构 spec 所述「ocas 里的数据本身」的落盘位置。
- **工作目录** → 宿主机目录 bind-mount 进容器内 `/workspace`（默认 `${PWD}`，可用 `WORKSPACE` 环境变量覆盖）。`sumeru.yaml` 的 `workspaceRoot: /workspace` 固定指向此路径（见 `config-load-workspace-root.md`）。
- **配置文件** → `./sumeru.yaml` 只读挂载到 `/app/sumeru.yaml`（compose 中 `read_only: true`）。运行期不允许容器改写自身配置。

## When

### When-1：声明式一键启动（compose）

- 操作者从仓库根目录运行 `docker compose -f docker/docker-compose.yaml up -d`。
- `docker-compose.yaml` 声明：
  - `image: sumeru:latest`
  - `ports: ["7900:7900"]`（宿主机端口可通过 `SUMERU_PORT` 环境变量改写：`"${SUMERU_PORT:-7900}:7900"`）
  - `volumes`：
    - `sumeru-ocas:/data/ocas`（named volume）
    - `${WORKSPACE:-.}:/workspace`（bind mount，工作目录）
    - `./sumeru.yaml:/app/sumeru.yaml:ro`（配置，只读）
    - `./docker/sumeru.env:/app/.env:ro`（凭据，只读；compose `env_file` 引用）
  - `environment`：透传 `SUMERU_OCAS_DIR=/data/ocas`、`HOME=/home/sumeru`
  - `restart: unless-stopped`
  - `healthcheck`：每 10s `curl -fsS http://127.0.0.1:7900/`（`GET /` 返回 200 即健康，见 architecture.md「实例信息」）

### When-2：CLI 一键启动（薄包装）

- 操作者运行 `sumeru docker start`（`@sumeru/cli` 新增子命令，`--port` / `--workspace` / `--ocas-volume` / `--gateway-config` 等透传到 compose 变量）。
- 该命令等价于拼装上述 compose 变量后执行 `docker compose -f docker/docker-compose.yaml up -d`，**不重复实现 Docker 编排逻辑**。出错时原样透传 compose 的 stderr。

### When-3：API 对等探测

- 容器 `up` 且 `healthcheck` 为 healthy 后，操作者从宿主机对每一个 architecture.md 列出的端点发起请求（基线对照：同一份 `sumeru.yaml` 在本机模式 `sumeru start` 下跑出相同响应）。

### When-4：数据持久化

- 容器跑出若干 turn 后，操作者 `docker compose down`（销毁容器，**不**带 `-v`）。

### When-5：失败与降级

- 操作者在未安装 Docker 的机器上运行 `sumeru docker start` 或 `docker compose ... up`。

## Then

### Then-1：镜像构建产物正确

- `docker build -t sumeru:latest -f docker/Dockerfile .` 退出码 0。
- `docker run --rm sumeru:latest node --version` 输出 `v22.*`。
- `docker run --rm sumeru:latest sh -lc 'command -v git && command -v node'` 两者都打印绝对路径。
- 缺失某个 adapter 二进制时镜像**仍然构建成功**（adapter 二进制是运行期 spawn 的依赖，构建期不校验存在性）。

### Then-2：容器启动后对外是标准 Sumeru endpoint

- `docker compose up -d` 后，宿主机 `curl -fsS http://127.0.0.1:${SUMERU_PORT:-7900}/` 返回 HTTP `200`，body 为 `@sumeru/instance` envelope（`{ type, value: { name, version, gateways } }`），与本机模式字节同构（`name`/`version` 字段一致；`gateways` 列表由挂载的 `sumeru.yaml` 决定）。
- 容器 stdout 出现本机模式同款启动行 `Listening on http://0.0.0.0:7900`（容器内 `--host 0.0.0.0`，对外端口由 compose 映射）。
- `[sumeru] ocas store: /data/ocas` 日志出现一次（与 `server-ocas-store-bootstrap.md` 契约一致），证明 ocas 落在 volume 上而非容器可写层。
- **缺二进制的 gateway 降级**：若 `sumeru.yaml` 声明了 `claude-code` 但镜像里没有 `claude`，`GET /gateways` 仍返回 200，该项 `status: "unavailable"`；不影响其他已就绪 gateway。

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

- `docker compose down`（不带 `-v`）后，`docker volume ls | grep sumeru-ocas` 仍列出该 named volume。
- 重新 `docker compose up -d` 后：
  - `GET /gateways/:name/sessions?q=<旧 task 关键词>` 能召回旧 session（ocas 内容寻址，重启幂等）。
  - 对旧 session id `GET .../sessions/:id` 返回原 recording（turn 列表、token、toolCalls 完整）。
  - `POST .../export` 导出的 tar.gz 与销毁前导出的字节同构（ocas 内容寻址决定，见 `server-session-export-endpoint.md` 的 Determinism 契约）。
- 只有显式 `docker compose down -v`（删 volume）才真正清除数据。`-v` 行为由 Docker 原生提供，本 spec 不改写。

### Then-5：凭据与隔离语义

- **凭据注入**：adapter 凭据（如 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`，见 `deploy-systemd-service-unit.md` Notes）经 `docker/sumeru.env`（chmod 600，**不**提交仓库；仓库仅留 `sumeru.env.example` 模板）+ compose `env_file` 注入容器。未配置凭据的 adapter 启动不致命（gateway `unavailable`，见 Then-2）。
- **隔离边界**：agent 在容器内 `apt install`、写 `/etc`、`rm -rf` 等动作**不触及宿主机根文件系统**，仅影响容器可写层与 `/workspace` bind mount。`/workspace` 是唯一双向共享面，agent 在此目录的写操作对宿主机可见 —— 这是设计意图（agent 的工作产物需可见），不算隔离失效。
- **网络出站**：容器可出站访问上游模型 API（bridge 默认 NAT）。需要更严网络隔离（禁止出站、只放行特定域名）时，操作者改写 compose `networks` 或加 `network_mode` —— 本 spec 不规定默认值，留给运维层。

### Then-6：宿主机无 Docker

- `sumeru docker start` 检测到 `docker` 不在 `PATH`（或 `docker info` 非 0 退出）时：
  - 退出码 `1`，stderr 单行：`Docker is not available. Install Docker or run 'sumeru start' for local mode.`
  - **不**打印 stack trace，不尝试任何 fallback。

### Tests（gated on Docker）

- 测试目录 `packages/cli/tests/docker-mode.test.ts`（或独立 `packages/scene-runner/tests/`），全部以 `SUMERU_DOCKER_INTEGRATION=1` 门控，无 Docker 时整体 skip，**不**算失败。
  - **构建**：`docker build` 成功；`node --version` 命中 22。
  - **启动 + 健康检查**：`compose up -d` → 轮询 `GET /` 直到 200（最多 30s）→ 断言 `@sumeru/instance` envelope 形状。
  - **往返**：`POST sessions` → `POST .../messages`（stubbed 或真实 agent，二选一）→ 断言 SSE 出现至少一个 `event: turn` + 一个 `event: done`。
  - **持久化**：跑出 turn → `compose down`（无 `-v`）→ `compose up -d` → 旧 session id 仍 `GET` 得到，turn 数不变。
  - **导出**：`POST .../export` → 200 + `application/gzip`；解压后含 `cas/*.bin`（与 `server-session-export-endpoint.md` 的 tar 布局一致）。
  - **降级**：用一份声明了不存在 adapter 的 `sumeru.yaml`，断言 `GET /gateways` 对应项 `unavailable` 且其他项不受影响。
  - **无 Docker**：临时从 `PATH` 移除 `docker`，运行 `sumeru docker start`，断言退出码 1 + 文档化错误信息。
- 所有既有（非 Docker）测试继续原样通过。

### Documentation

- `README.md` 部署章节新增「Docker 模式」小节：3–6 行，给出 `docker compose -f docker/docker-compose.yaml up -d` 与「ocas 落 volume、`down` 不丢数据、`-v` 才清除」两点。
- 链回 architecture.md「部署模式 → Docker 模式」与本 spec。

## Non-goals

- **不**做 Kubernetes / 远程编排（Docker Compose + 单机即覆盖隔离实验场景；K8s 是另一层）。
- **不**做多容器水平扩缩（一个 compose 栈 = 一个 Sumeru 实例 = 一个 endpoint；要多个就起多份 compose）。
- **不**做镜像签名 / 镜像扫描（信任来自仓库构建链，超出本 spec）。
- **不**规定 agent 二进制版本固定策略（版本钉死由 adapter 包 / CI 处理；镜像构建期读取 lockfile）。
- **不**实现 `sumeru run <scene>` 的一次性实验流程 —— 那是 `specs/cli/sumeru-run-scene.md` 的职责，本 spec 只提供**它复用的基础设施**（镜像 + volume + compose + API 对等）。
