# Sumeru v3 — Spec Checklist

> 重写于 2026-06-29（v3 重构后）。旧 v2 specs 已移至 `specs/legacy/`。
>
> **权威设计文档**：[spec-v3 wiki](https://git.shazhou.work/shazhou/sumeru/wiki/spec-v3)
>
> **格式**：Given/When/Then + YAML frontmatter（scenario/feature/tags）。
> 每个 spec 验证一个具体的 user story 或 invariant。

---

## Session 生命周期

- [x] `session/create-and-start.md` — POST /sessions 创建即启动，校验 prototype/project/model/image，返回 SessionInfo
- [x] `session/stop-running-session.md` — POST /sessions/:id/stop running→idle(exit.type=stopped)，已 idle→409
- [x] `session/delete-session.md` — DELETE /sessions/:id 停止+清理容器+数据
- [x] `session/list-and-detail.md` — GET /sessions 列表 + GET /sessions/:id 详情，SessionInfo 结构
- [x] `session/concurrency-fifo-queue.md` — maxRunning 达到后排队 FIFO，idle 释放槽位后唤醒

## SSE 事件流

- [x] `sse/turn-exit-heartbeat.md` — GET /sessions/:id/events 只有三种事件(turn/exit/heartbeat)，exit 后关流
- [x] `sse/last-event-id-resume.md` — 断开重连带 Last-Event-ID，补发缺失事件

## Resume（消息 + 热注入）

- [x] `resume/message-resume-idle.md` — POST /sessions/:id/messages idle 时 resume，running 时 409
- [x] `resume/env-hot-injection.md` — resume 带 env，注入容器环境（不进 agent 上下文）
- [x] `resume/model-hot-switch.md` — resume 带 model，切换 session 的 model 配置

## Turns 查询

- [x] `turns/list-turns-pagination.md` — GET /sessions/:id/turns 返回 Turn[]，支持 ?after= 分页
- [x] `turns/turn-discriminated-union.md` — Turn 是 assistant|tool discriminated union，结构正确性

## Prototype 管理

- [x] `prototype/crud-lifecycle.md` — GET/POST/PUT/DELETE /prototypes，创建需 name+instructions
- [x] `prototype/skill-reference-validation.md` — 创建/更新时引用的 skill 必须存在，否则 400

## Skill 管理

- [x] `skill/crud-idempotent.md` — GET/PUT/DELETE /skills/:name，PUT 幂等
- [x] `skill/delete-reverse-reference-protection.md` — 删除被 prototype 引用的 skill → 409

## Image（只读）

- [x] `image/list-and-detail.md` — GET /images 列表 + GET /images/:name 详情，元数据结构(name/description/dockerfile/builtAt/digest)

## Host 根

- [x] `host/root-status.md` — GET / 返回 name/version/status(running/queued/idle)/uptime

## 错误码

- [x] `errors/standard-http-errors.md` — 400/404/409/429/500 标准错误码覆盖

---

## 编排原则

1. **每个 spec 聚焦一个 user story / invariant** — 不混搭多个场景
2. **Given/When/Then 格式** — Given 设置前提，When 做操作（含具体 curl/API 调用），Then 断言响应
3. **基于真实实现** — 读 `packages/host/src/` 代码确认实际行为，不臆测
4. **引用 wiki 作为设计意图** — spec 验证实现是否符合 wiki 设计
5. **tags 标注** — `[session, lifecycle, v3]` 等便于筛选
