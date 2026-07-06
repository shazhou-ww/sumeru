# Sumeru 0.3.0 — Test Scenarios 总纲

> 覆盖所有核心场景。每个 scenario 对应一个可独立验证的行为。

## 1. Session 生命周期

| # | 场景 | 验证点 |
|---|------|--------|
| 1.1 | 创建 session（happy path）| POST /sessions → running, 容器启动, adapter exec |
| 1.2 | 创建 session（project = null）| 不挂 /workspace，agent cwd = HOME |
| 1.3 | 创建 session（prototype 不存在）| 404 prototype_not_found |
| 1.4 | 创建 session（project 路径越界）| 400 invalid_project |
| 1.5 | Session done → idle | agent 完成任务后 status=idle, exit.type=complete |
| 1.6 | Session 多轮对话 | idle → POST /messages → running → idle（历史保持）|
| 1.7 | Session stop | POST /sessions/:id/stop → idle, exit.type=stopped |
| 1.8 | Session stop（已 idle）| 409 session_already_idle |
| 1.9 | Session delete（idle）| DELETE → 容器删除, session 消失 |
| 1.10 | Session delete（running）| DELETE → 停止 + 清理 |
| 1.11 | 并发排队 | maxRunning 满后新 session 排队, 前者 idle 后唤醒 |

## 2. SSE 事件流

| # | 场景 | 验证点 |
|---|------|--------|
| 2.1 | Turn 事件 | GET /events → `event: turn` + JSON Turn 对象 |
| 2.2 | Exit 事件 | agent done 后收到 `event: exit` |
| 2.3 | Last-Event-ID 断线重连 | 带 header → 补发缺失事件 |
| 2.4 | Turn durationMs | assistant turn 有 wall-clock 毫秒 |
| 2.5 | Turn tokenUsage | turn 带 input/output/cached token 统计 |

## 3. Turns 查询

| # | 场景 | 验证点 |
|---|------|--------|
| 3.1 | GET /turns 全量 | 返回 Turn[]，assistant + tool 分离 |
| 3.2 | GET /turns?after=N | 分页，只返回 id > N 的 turns |
| 3.3 | Turn discriminated union | assistant turn 有 toolCalls，tool turn 有 callId + result |

## 4. Commands API

| # | 场景 | 验证点 |
|---|------|--------|
| 4.1 | model 命令 | POST /commands → 写容器内 config，session model 更新 |
| 4.2 | reset 命令 | 清上下文 + 可选更新 persona |
| 4.3 | install-skill 命令 | skill 文件写入容器 |
| 4.4 | snapshot 命令 | docker commit → 新 image 注册为 prototype |

## 5. Registry（Provider / Model / Persona / Skill）

| # | 场景 | 验证点 |
|---|------|--------|
| 5.1 | Provider CRUD | PUT 创建/更新, GET 查, DELETE 删 |
| 5.2 | Model CRUD | 嵌套在 provider 下, PUT/GET/DELETE |
| 5.3 | Persona CRUD | PUT/GET/DELETE, instructions + skills |
| 5.4 | Skill CRUD | PUT 幂等, DELETE 检查反向引用 |
| 5.5 | Skill 反向引用保护 | 被 persona 引用的 skill 不可删(409) |

## 6. Prototype 发现

| # | 场景 | 验证点 |
|---|------|--------|
| 6.1 | Docker image 自动发现 | 有 sumeru.harness label 的 image 出现在 GET /prototypes |
| 6.2 | Image label 属性 | sumeru.persona / sumeru.model 正确解析 |
| 6.3 | Compose-based prototype | prototypes/ 目录下 compose.yaml 被识别 |

## 7. Docker 容器行为

| # | 场景 | 验证点 |
|---|------|--------|
| 7.1 | Project mount | 宿主机路径挂到容器 /workspace:rw |
| 7.2 | 共享缓存 mount | /cache/{pnpm-store,npm,uv,pip} |
| 7.3 | Container stop/start | writable layer 保留（包跨重启存活）|
| 7.4 | 多轮 session keep-alive | done 后容器不 stop（adapter 进程存活）|
| 7.5 | Suspend/error → container stop | 异常情况释放资源 |

## 8. Adapter 协议

| # | 场景 | 验证点 |
|---|------|--------|
| 8.1 | NDJSON init → ready | adapter 收到 init frame 回复 ready |
| 8.2 | Message → turns → done | 完整 ReAct loop |
| 8.3 | Adapter 异常退出 | host 正确标记 error + 不崩溃 |
| 8.4 | ACP init timeout | hermes ACP 卡住时 30s 后报错 |
| 8.5 | Invalid endpoint 快速失败 | buildHermesConfig 无效 URL → 立即报错 |

## 9. 错误码

| # | 场景 | 验证点 |
|---|------|--------|
| 9.1 | 400 Invalid JSON | 请求 body 非法 |
| 9.2 | 400 Missing fields | 缺少必填字段 |
| 9.3 | 404 Session not found | 不存在的 session id |
| 9.4 | 404 Prototype not found | 不存在的 prototype |
| 9.5 | 409 Conflict | stop 已 idle session, delete 引用中的 skill |

## 10. Host 根

| # | 场景 | 验证点 |
|---|------|--------|
| 10.1 | GET / | 返回 name, version, status, uptime |

---

## 原则

1. 每个场景可独立跑（不依赖其他场景的 side effect）
2. Given/When/Then 格式
3. 基于实际 API（server.ts 路由表），不臆测
4. 场景编号稳定，新增在末尾追加
