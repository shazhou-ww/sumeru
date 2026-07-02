# Sumeru Docker 嵌套可行性技术分析报告

> 评估场景：外层 host（跑在 VM 上）创建一个 worker 实例，该实例的容器里要跑一个**内层 sumeru host**，内层 host 再管理自己的 worker 实例（跑自测）。
> 分析基线：v3 重构后的 `packages/host`（Provider/Model/Persona/Prototype + SQLite），commit 当前工作树状态。
> 注：任务清单里若干路径（`local-transport.ts`/`instance-manager.ts`/`docker-launch.ts`/`docker-assets.ts`/`packages/server`）在 v3 已不存在或迁入 `legacy/`，本报告以实际代码为准并标注。

---

## 一、当前执行模型（A 部分）

### A1. docker CLI 在 host 进程（VM）上，不在容器内；container handle 由 compose up 返回并存在 session 记录里

- `packages/host/src/transport.ts:40-44` —— `createDockerTransport({ dockerBin, composeBin })`，二进制路径默认字面量 `"docker"`（非硬编码绝对路径，走 host 进程的 `PATH`）。`spawn(args[0], args.slice(1))` 在 **host 进程**（VM）里拉起 `docker` CLI 子进程。
- `transport.ts:129-136` —— `exec()` 拼装 `docker exec -i -w /opt/sumeru [-e K=V ...] <containerId> ...command`。`containerId` 是入参，**来自调用方**。
- `packages/host/src/session-manager.ts:159-183` —— `createSession` 调 `transport.up({...})`，把返回的 `up.containerId` 存进 `ManagedSession.containerId`（`types.ts:52-59`）。后续 `exec` / `inspectStatus` 都用这个 handle。
- 结论：**docker CLI 跑在 VM 上，不在 worker 容器里**。container handle = `docker compose ps -q` 取到的第一个容器 ID（`transport.ts:71-93`），生命周期绑在 session 上。

### A2. 容器按需创建/销毁（compose up per session），由 host 的 transport 负责，不是 CLI

- `transport.ts:47-94` `up()` = `docker compose -f <composePath> -p <projectName> up -d`；`down()`/`rm()` 分别对应 `compose down` / `compose rm -f`。
- `session-manager.ts:159` 创建时 `up`；`:242-251` `deleteSession` 时 `down` + `rm`。`:187-209` 异常路径也会清理。
- 镜像 `CMD ["sleep","infinity"]`（见四份 Dockerfile 末行）只是让容器起来后常驻，**但每个 session 仍是独立 compose project**，session 结束即销毁。不是全局共享的 `sleep infinity` 长驻容器。
- v3 **没有** `packages/cli/src/docker-launch.ts`（已迁 `legacy/cli/src/docker-launch.ts`，且那是 legacy 的"host 自身容器化"启动器，与 v3 worker 容器无关）。v3 CLI（`packages/cli/src`）只剩 `main.ts`/`http-client.ts`/`pid-file.ts`/`format.ts`，是 host 的 HTTP 客户端，**不参与容器编排**。

### A3. Worker 实例与容器严格 1:1

- `session-manager.ts:159-183` 每次 `createSession` 生成新 `sessionId`、新 `projectName = projectNameFromSessionId(id)`（`id.ts`），调一次 `transport.up`，得到独立 `containerId`。
- `ManagedSession.containerId` 是单值字段（`types.ts:53`），无多容器复用语义。
- v3 **已删除** master/worker/inst_0/local-transport/routing-transport 概念。全仓 `packages/host/src` 搜 `local|routing|master|inst_0|worker` 仅命中一处错误提示字符串（`handlers/sessions.ts:215`）。**v3 是扁平模型：一个 host 进程管 N 个 session，每个 session = 1 compose project = 1 容器**。

---

## 二、嵌套可行性评估（B 部分，逐条）

### B4. 内层 host 调 `docker exec` 的能力 —— ❌ 硬卡点（当前镜像无 docker CLI、无 daemon 访问）

- 四份 v3 镜像（`packages/adapter-claude-code|adapter-hermes|sarsapa|adapter-codex/Dockerfile`）均 `FROM node:24-slim`，只装 `git/curl/ca-certificates/build-essential`（sarsapa 多 `ripgrep`，hermes/codex 多 `uv+python`，claude-code/codex 各装对应 npm 包）。**没有任何一份安装 docker CLI**。
- 全仓搜 `privileged|docker\.sock|/var/run/docker|--network|network_mode`：当前 v3 代码 **0 命中**（仅 legacy spec/test 里有 `--network host` 字样）。prototype compose（`prototypes/sarsapa-worker/compose.yaml`、`examples/minimal/prototypes/echo-worker/compose.yaml`）只 bind-mount `${SUMERU_PROJECT_PATH}`，**无 docker.sock 挂载、无 privileged、无 DinD**。
- `transport.ts:43` 内层 host 会 `spawn("docker",["exec",...])` —— 容器内无 `docker` 二进制 → `ENOENT` 直接失败。
- 要让内层 host 能管 worker，必须二选一：
  - (a) **DooD（Docker-out-of-Docker）**：把宿主机 `/var/run/docker.sock` bind-mount 进内层容器 + 装 docker CLI。内层 host 的 `docker exec` 实际打到**外层 VM 的 daemon**，管的容器和内层 host 同级（不是真嵌套，是共享 daemon）。隔离弱、命名空间易冲突。
  - (b) **DinD（Docker-in-Docker）**：内层容器 `--privileged` + 装 dockerd。真嵌套、隔离强，但 privileged 容器安全面大、storage driver 嵌套有坑。

### B5. 内层 host HTTP 端口的发现与访问 —— ❌ 硬卡点（v3 prototype compose 不做端口映射）

- v3 prototype compose（`prototypes/sarsapa-worker/compose.yaml`）**无 `ports:` 段**，只有 `volumes` + `environment`。host 用 `docker exec` 直接 stdin/stdout 通信，**不依赖容器暴露 HTTP 端口**——所以 worker 容器根本没有端口映射能力。
- 内层 host 要监听 HTTP（`packages/host/src/main.ts:12-13`，`SUMERU_HOST` 默认 `127.0.0.1`、`SUMERU_PORT` 默认 `7900`；`server.ts:149` `server.listen(port, host)`）。但：
  - 容器内 `127.0.0.1:7900` 只在容器 network namespace 内可达，外层 host 在 VM 上**访问不到**。
  - 要外层访问，prototype compose 必须加 `ports: ["<hostPort>:7900"]`，或用 `network_mode: host`，或外层 host 通过 `docker exec` 进内层容器 curl（最丑但改动最小）。
- `transport.ts:6` `ADAPTER_BASE="/opt/sumeru"` 硬编码；`:185` `defaultAdapterCommand` = `["node","/opt/sumeru/adapter-<x>/dist/main.js"]`。内层 host 作为"adapter"被外层 exec 时，外层期待的是 NDJSON stdin/stdout 协议（`session-manager.ts:327-332` 写 `{"type":"message",...}\n`），**不是 HTTP**。内层 host 当前是 HTTP server，**协议不匹配**——外层没法直接把它当 adapter exec。

### B6. 镜像是否打包 `@sumeru/host` —— ❌ 硬卡点（只打包 adapter，无 host）

- 四份 Dockerfile 的 `COPY` 段只拷 `packages/core`、`packages/adapter-core`、`packages/adapter-<x>`，并 `ln -s` 到 `node_modules/@sumeru/{core,adapter-core,adapter-<x>}`。**没有 `packages/host`**。
- 镜像里没有 `@sumeru/host`，也没有 `sumeru` host 启动命令。要在容器内跑 host，镜像必须补：
  - `COPY packages/host/package.json ./host/` + `COPY packages/host/dist ./host/dist/`
  - `ln -s /opt/sumeru/host node_modules/@sumeru/host`
  - host 的运行时依赖：`better-sqlite3`（`sqlite-store.ts:8` `import Database from "better-sqlite3"`）—— 这是 **native 模块**，需 `build-essential`（镜像已有）+ 平台 prebuild 或源码编译，且 Node 版本要匹配（镜像 `node:24-slim`，host 包的 `better-sqlite3` 版本要支持 Node 24）。
  - 一份 `host.yaml` + `data/` 目录（见 B7/B8）。
  - host 的入口（`packages/host/src/main.ts`）：`node /opt/sumeru/host/dist/main.js <rootDir>`。

### B7. host 配置加载路径 —— ⚠️ 需改造（路径相对 rootDir，可配置但有硬编码点）

- `packages/host/src/config.ts:26-28`：`DEFAULT_HOST_FILE="host.yaml"`、`DEFAULT_DATA_DIR="data"`。`:33` `configPath = join(rootDir, "host.yaml")`。`:44` `dataDir = join(rootDir, "data")`。
- `main.ts:11`：`rootDir = resolve(process.argv[2] ?? process.cwd())`。**rootDir 可由 argv 注入**，不是硬编码——这点对嵌套友好。
- 但 `config.ts:59` `sqliteStore = openDatabase(join(dataDir, "sumeru.db"))`，路径完全由 rootDir 派生，**无 env 覆盖**。嵌套时需为内层 host 指定独立 rootDir（如 `/opt/sumeru-inner`），并把 `host.yaml` 放进去。
- `config.ts:371-376` `workspaceRoot` 是 `host.yaml` 必填字段，`resolveProjectPath`（`:237-259`）强制 project 必须落在 `workspaceRoot` 之下。内层 host 的 workspaceRoot 要指向容器内可写目录（如 `/workspace`）。
- `main.ts:12-13` `SUMERU_HOST`/`SUMERU_PORT` env 可覆盖监听地址——对嵌套友好。

### B8. SQLite store 数据库路径与嵌套隔离 —— ⚠️ 需改造（单文件 DB，靠 rootDir 隔离）

- `sqlite-store.ts:204-209` `openDatabase(dbPath)` 接受任意路径；`config.ts:59` 传入 `join(dataDir,"sumeru.db")` = `<rootDir>/data/sumeru.db`。
- 没有全局单例/锁文件机制，**多个 host 进程用不同 rootDir 即可天然隔离**。但：
  - 容器内 `/opt/sumeru/data/sumeru.db` 若落在镜像层，容器销毁即丢。需把 `data/` 挂到 volume 或 bind-mount。
  - `better-sqlite3` 是进程内嵌入式 DB，**不支持跨容器并发写同一文件**——不能让外层和内层 host 共用一个 db 文件。各自独立 rootDir 即可避免。
  - `ocas-recorder.ts`（`session-manager.ts:94` `createOcasRecorder(hostConfig.dataDir)`）也写 `dataDir`，同样需隔离。

---

## 三、现有 docker-mode 设计意图（C 部分摘要）

### C9. docker-mode spec 描述的是"把 host 自身容器化部署"，不是"host 管理 worker 容器"；未考虑嵌套

- 任务提到的 `.worktrees/fix/82-docker-deployment-mode` **不存在**；实际 worktree 是 `.worktrees/review/pr-104`，其 `specs/architecture/docker-mode.md` 与 `legacy/specs/architecture/docker-mode.md` **内容一致**（同 scenario 行、同 235 行）。
- spec 开宗明义（`legacy/specs/architecture/docker-mode.md:2`）：*"在一个 Docker 容器内运行 Sumeru + agent，对外暴露与本机模式完全一致的 HTTP endpoint"*。即**容器化 host 自身**，端口映射 `7900:7900`，ocas 落 named volume，一份 `sumeru.yaml`（带 `deploy:` 块）= 一个工作单元。
- 该 spec 描述的镜像（`:70-85`）通过 `pnpm add -g @sumeru/cli` 装 host 全套，**但这是 legacy 架构**（Instance/Gateway/Session，gateways 概念）。v3 已重构为 Prototype/Persona/Provider/Model + SQLite，**该 spec 与 v3 host 实现已脱节**。
- **完全未考虑嵌套**：spec 假设容器内 host 直接通过 gateway 跑 agent，agent 是容器内进程（claude/hermes 二进制），**不存在 host→docker exec→worker 容器 的二层**。Non-goals（`:227-235`）明确"不做多容器水平扩缩"。隔离边界（`:198`）只谈 agent 在容器内的影响，未涉及容器内再起 docker。

### C10. docker run / compose 参数：无 privileged、无 docker.sock、无特殊网络

- v3 prototype compose（`prototypes/sarsapa-worker/compose.yaml`、`examples/minimal/prototypes/echo-worker/compose.yaml`）：仅 `image` + `mem_limit/cpus` + `volumes: ["${SUMERU_PROJECT_PATH}:${SUMERU_PROJECT_PATH}"]` + `environment`。**无 ports/privileged/docker.sock/network_mode**。
- v3 transport（`transport.ts:47-94`）只发 `docker compose up -d`，**不传额外 flag**；compose 文件即 prototype 的 `compose.yaml`（`session-manager.ts:161` `composePath: prototype.composePath`）。
- legacy 的 `docker-launch.ts:199` argv = `["compose","-p",name,"up","-d","--build"]`，env 注入 `SUMERU_PORT/WORKSPACE/SUMERU_IMAGE/SUMERU_CONFIG`，**同样无 privileged/docker.sock**。legacy compose 模板（`legacy/server/templates/docker/docker-compose.yaml:16-27`）有 `ports` 但那是 host 自身容器化用的，与 worker 无关。
- `config.ts:295-336` `validateComposeProjectVolume` 强制 prototype compose **必须** bind-mount `${SUMERU_PROJECT_PATH}`（issue #171），但**不校验也不允许**端口/socket 相关配置。

---

## 四、实现建议

**结论：当前架构下 Docker 嵌套不可直接实现，存在 3 个硬卡点（B4/B5/B6），需中等规模改造。** 可行路径如下：

### 路径 A（推荐）：DooD + 新增"host-as-adapter"桥接 + 端口映射

1. **新建一个 `adapter-host` 适配器包**（`packages/adapter-host`），实现 `@sumeru/adapter-core` 的 NDJSON 协议，内部用 HTTP client（`packages/cli/src/http-client.ts` 可复用）调内层 host 的 `/sessions` + `/sessions/:id/messages`。这样外层 host 用统一 `docker exec` 协议拉起内层 host，**不破 v3 通信模型**。
2. **新建 `docker/host/Dockerfile`**（或在现有镜像基础上加层）：
   - `COPY packages/host` + `COPY packages/adapter-host` + 链 `node_modules/@sumeru/host`
   - `RUN npm i better-sqlite3`（或 COPY prebuilt）
   - 装 docker CLI：`RUN apt-get install -y docker.io`（仅 CLI，不跑 daemon）
   - `COPY` 一份内层 `host.yaml` 到 `/opt/sumeru-inner/host.yaml`
   - 入口：外层 exec `node /opt/sumeru/adapter-host/dist/main.js`，它 fork 内层 `node /opt/sumeru/host/dist/main.js /opt/sumeru-inner`
3. **内层 host 的 worker 容器管理**：把外层 VM 的 `/var/run/docker.sock` bind-mount 进内层容器（在 prototype compose 的 `volumes` 加 `- /var/run/docker.sock:/var/run/docker.sock`）。内层 host 的 `docker exec` 打到外层 daemon —— **这是 DooD，不是真嵌套**，但改动最小。内层 host 的 `projectName` 已含随机 sessionId（`id.ts`），与外层 project 名冲突概率低，但需在 `transport.ts` 加 project 前缀隔离层避免歧义。
4. **端口**：内层 host 监听 `127.0.0.1:<随机端口>`；因 adapter-host 和内层 host 同容器，走 `127.0.0.1` 即可，**无需端口映射到 VM**。若要外层 VM 直接访问，prototype compose 加 `ports: ["<port>:7900"]`。
5. **数据隔离**：内层 rootDir = `/opt/sumeru-inner`，`data/sumeru.db` 落容器可写层或挂独立 volume。

### 路径 B（重隔离）：DinD

- 内层容器 `--privileged` + 装 dockerd（`docker:dind` 镜像为基础）。真嵌套，内层 daemon 独立。但 privileged 消除隔离边界，与 sumeru"不信任 agent"的隔离初衷冲突，**不推荐**。

### 路径 C（避坑，最简）：放弃容器内跑 host，改用"外层 host 直接多 session 自测"

- v3 host 已是扁平多 session 模型（A3）。自测场景直接在外层 host 用一个独立 prototype（指向 sumeru 仓库自身 as workspaceRoot）创 session 即可，**无需嵌套**。仅当需"agent 跑在容器里、host 也跑在容器里"的双重隔离时才需路径 A。

### 需改动的文件清单（路径 A）

| 文件 | 改动 |
|------|------|
| `packages/adapter-host/`（新建） | 实现 adapter-core 协议，桥接到内层 host HTTP |
| `docker/host/Dockerfile`（新建） | 装 docker CLI + better-sqlite3 + host/adapter-host 包 + 内层 host.yaml |
| `prototypes/<name>/compose.yaml` | 加 `- /var/run/docker.sock:/var/run/docker.sock` volume；可选 `ports:` |
| `packages/host/src/transport.ts:43` | `dockerBin` 已可由 `options.dockerBin` 注入，无需改；但建议加 project 前缀防命名冲突 |
| `packages/host/src/config.ts:59` | 可选：支持 `SUMERU_DB_PATH` env 覆盖 db 路径，便于嵌套时显式隔离 |
| 内层 `host.yaml` | `workspaceRoot` 指向容器内 `/workspace`，`maxRunning` 调小 |

---

## 五、关键代码引用

| 结论 | 文件:行 | 代码片段 |
|------|---------|----------|
| docker CLI 在 host 进程 | `packages/host/src/transport.ts:43` | `const dockerBin = options.dockerBin ?? "docker";` |
| exec 拼装 | `packages/host/src/transport.ts:130` | `const args = [dockerBin, "exec", "-i", "-w", ADAPTER_BASE];` |
| ADAPTER_BASE 硬编码 | `packages/host/src/transport.ts:6` | `const ADAPTER_BASE = "/opt/sumeru";` |
| compose up per session | `packages/host/src/transport.ts:52-62` | `composeBin, "compose", "-f", composePath, "-p", projectName, "up", "-d"` |
| containerId 存 session | `packages/host/src/session-manager.ts:176` | `containerId: up.containerId,` |
| deleteSession 销毁 | `packages/host/src/session-manager.ts:242-251` | `transport.down(...)` + `transport.rm(...)` |
| 1:1（每 session 新 project） | `packages/host/src/session-manager.ts:157` | `const projectName = projectNameFromSessionId(id);` |
| host 默认用 docker transport | `packages/host/src/server.ts:115` | `const transport = config.transport ?? createDockerTransport();` |
| rootDir 来自 argv | `packages/host/src/main.ts:11` | `const rootDir = resolve(process.argv[2] ?? process.cwd());` |
| host/port 来自 env | `packages/host/src/main.ts:12-13` | `SUMERU_HOST ?? "127.0.0.1"` / `SUMERU_PORT ?? "7900"` |
| host.yaml 路径 | `packages/host/src/config.ts:33` | `const configPath = join(rootDir, DEFAULT_HOST_FILE);` |
| dataDir 路径 | `packages/host/src/config.ts:44` | `const dataDir = join(rootDir, DEFAULT_DATA_DIR);` |
| SQLite db 路径 | `packages/host/src/config.ts:59` | `openDatabase(join(dataDir, "sumeru.db"))` |
| native 依赖 | `packages/host/src/sqlite-store.ts:8` | `import Database from "better-sqlite3";` |
| 强制 bind-mount project | `packages/host/src/config.ts:295-336` | `validateComposeProjectVolume` |
| compose 无端口/socket | `prototypes/sarsapa-worker/compose.yaml:10-11` | 仅 `volumes: ["${SUMERU_PROJECT_PATH}:${SUMERU_PROJECT_PATH}"]` |
| 镜像无 docker CLI | `packages/sarsapa/Dockerfile:8-17` | 仅 `git curl ca-certs build-essential ripgrep` |
| 镜像无 host 包 | `packages/sarsapa/Dockerfile:21-32` | 只 COPY core/adapter-core/adapter-sarsapa |
| 镜像 sleep infinity | `packages/sarsapa/Dockerfile:44` | `CMD ["sleep", "infinity"]` |
| v3 无 local transport | `packages/host/src/` 全搜 | 仅 `handlers/sessions.ts:215` 命中（错误提示串） |
| docker-mode 是 host 容器化 | `legacy/specs/architecture/docker-mode.md:2` | "在一个 Docker 容器内运行 Sumeru + agent" |
| docker-mode 未考虑嵌套 | `legacy/specs/architecture/docker-mode.md:229-230` | Non-goals: 不做多容器水平扩缩 |
