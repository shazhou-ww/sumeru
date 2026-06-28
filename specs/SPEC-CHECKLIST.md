# Sumeru v2 — Usage Scenario Validation Checklist

> 重写于 2026-06-28（v2 重构后）。旧 v1 checklist 与 74 个 v1 spec 已移至 `legacy/specs/`（作参考，不删）。
>
> **方法**：按新 wiki（`cards/` 17 张架构卡）梳理出 v2 的主要**使用场景**，逐个**摸索正确用法** → 写成 spec；**发现 bug → 开 issue**。
> 由星月（RAKU）编排，每个场景派一个 subagent 顺序摸索。

---

## 现状基线（2026-06-28 recon）

| 项 | 状态 |
|---|---|
| v2 build | ✅ 绿（需先 `pnpm install` 链 workspace，scaffold 后从未跑过 → 已修） |
| 可运行示例 | ❌ **无** —— 仓库无 `host.yaml` / `prototypes/`，根 `sumeru.yaml` 是 v1 `gateways:` 格式。**S1 的首要产物就是造出来。** |
| docker daemon | ✅ colima up（worker/prototype 场景需要；master 走 local transport 不需要） |
| agent CLIs | ✅ claude / codex / cursor-agent / hermes 均在 PATH |
| OCAS 记录 | 🔴 **假实现**（#148）—— recorder 写 flat jsonl、`hash:null`，非真 CAS。S8 阻塞于此。 |

---

## 场景清单（按依赖 + 摸索顺序）

> 图例：状态 ⬜ 未开始 / 🔄 摸索中 / ✅ spec 已写 / 🔴 阻塞。依赖列指明前置场景。

| # | 场景 | 验证什么（覆盖的卡） | 依赖 | docker | 真 agent | 状态 |
|---|------|------|------|--------|---------|------|
| **S1** | **Host bootstrap & discovery** | 从零写最小 `host.yaml` + 一个 `prototypes/<n>/{manifest,compose}.yaml` → `sumeru start` → `GET /` 返回 host 身份信封、master `inst_0` 在列（architecture-overview, host-service, manifest-schema, master-agent） | — | no | no | ⬜ |
| **S2** | **Master agent roundtrip** | 向 `inst_0` 投 inbox → 订阅 outbox → 收到 turn/done。验证 local transport + master adapter（hermes，读 ~/.hermes/config）（master-agent, transport-layer/local, adapter-hermes） | S1 | no | yes | ⬜ |
| **S3** | **Inbox→Outbox SSE 管道** | POST inbox 生成 messageId → GET outbox SSE 流（turn/done/suspend/error 帧 + heartbeat），replay/reconnect（host-service, sse-reliability） | S2 | no | yes | ⬜ |
| **S4** | **Suspend / Resume** | 触发 timeout suspend → 状态翻 suspended → 下次 inbox 注入 resumeNativeId 续上（suspend-resume, adapter-contract） | S3 | no | yes | ⬜ |
| **S5** | **Adapter 契约一致性** | 直接喂 NDJSON（init→ready→message→turn→done）给每个 adapter 二进制，验证协议序与错误帧。逐个：hermes(ACP) / claude-code / codex（adapter-contract, adapter-*） | S1 | no | yes | ⬜ |
| **S6** | **Prototype versioning / 懒重初始化** | 改 manifest/skills → hash 漂移 → 下次 inbox 触发 re-init（prototype-versioning, manifest-schema） | S2 | no | yes | ⬜ |
| **S7** | **Worker instance 生命周期（docker）** | 从 prototype `create` → compose up 容器 → inbox/outbox → `reset` → `delete`（compose down/rm）+ maxInstances 资源闸（instance-lifecycle, transport-layer/docker, docker-image） | S1,S2 | **yes** | yes | ⬜ |
| **S8** | **OCAS 记录 / history / search / export** | 🔴 **阻塞 #148**：当前 recorder 是假的。先摸索当前（坏）行为、记录 gap，待 #148 修后补真 spec（ocas-recording） | S2 | no | — | 🔴 |
| **S9** | **CLI operator 面** | `sumeru server start/stop/status` · `prototypes` · `instances` · `create/send/logs/reset/delete` · `images`（cli） | S1 | partial | no | ⬜ |
| **S10** | **部署为常驻服务（launchd/systemd）** | repo `deploy/` 只有 systemd unit；mac 要 launchd 三件套。验证常驻 + 重启恢复（deploy-systemd） | S1 | no | no | ⬜ |

---

## 编排原则

1. **S1 先行、单独跑** —— 它产出 v2 第一个可运行示例（`host.yaml` + `prototypes/`），是后续所有场景的共享前置。在它跑通前别派其它场景。
2. **顺序摸索** —— 每个 subagent 摸一个场景，回报「正确用法 + 写好的 spec + 开的 issue 号」。星月整合后再派下一个，保持全局上下文清爽。
3. **摸索 = 真跑** —— 不是读代码臆测。subagent 必须真起 host、真投消息、真看输出，用实证写 spec。
4. **spec 格式** —— 沿用 v2 现有 spec 的 Given/When/Then + frontmatter（scenario/feature/tags），参考 `specs/adapter-core/*` 与 `specs/core/*`。
5. **bug → issue** —— 摸索中发现实现与卡片/预期不符，按 `gitea-cli-operations` 开 issue（REST + User-Agent + label id），spec 里标 `⚠️ 见 #N`。

---

## 进度日志

| 日期 | 场景 | subagent 结果 | 产出 spec | 开的 issue |
|------|------|--------------|----------|-----------|
| 2026-06-28 | 准备 | recon + 115 v1 specs → legacy/ + build 修复 + checklist | 本文件 | #148(host CAS), #149(eval RFC) |
