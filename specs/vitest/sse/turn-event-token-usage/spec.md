---
scenario: SSE turn 事件透传 adapter 上报的 tokenUsage，未知时为 null 而非全零
feature: GET /sessions/:id/events — AssistantTurn.tokenUsage
tags: [sse, turns, token-usage, host, wire-turn, bug-178]
---

# SSE turn 事件：tokenUsage 透传，未知为 null

`event: turn` 推送的 `AssistantTurn.tokenUsage` 必须**透传 adapter 实际上报的 token 消耗**。
当 adapter 未提供该 turn 的 token 数据时，host 必须输出 `null`，**而不是用 `{input:0,
output:0, cached:0}` 伪装成"消耗为零"**。

## 背景（当前 Bug — #178）

`packages/host/src/wire-turn.ts` 当前用全零默认值掩盖"未知"：

```typescript
// wire-turn.ts:10,36（当前实现）
const EMPTY_TOKEN_USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };
const tokenUsage = wire.tokens ?? EMPTY_TOKEN_USAGE;
```

于是当 `wire.tokens === null`（adapter 没在该 turn 帧带 token）时，SSE 输出
`tokenUsage: {input:0, output:0, cached:0}` —— 把"未知"错误地表达为"零消耗"，正是 issue
观测到的现象。

> 关联类型变更：`packages/core/src/types.ts:74-82` 中 `AssistantTurn.tokenUsage` 当前为
> 非空 `TokenUsage`。要表达"未知"，需放宽为 `TokenUsage | null`（符合 `CLAUDE.md` 的
> "用 `T | null` 而非可选属性"约定）。

---

## Scenario 1: adapter 上报了该 turn 的 token → 原样透传

**Given** 一个运行中的 session，adapter 在某个 turn 帧的 `TurnValue.tokens` 中带回
`{input:100, output:20, cached:0}`

**When** 客户端读取该 turn 事件：

```bash
grep -A1 '^event: turn' /tmp/sse-output.txt | grep '^data:' | head -1 \
  | sed 's/^data: //' | jq '.tokenUsage'
```

**Then** 输出原样透传，不被清零、不被改写：

```json
{ "input": 100, "output": 20, "cached": 0 }
```

---

## Scenario 2: adapter 未上报该 turn 的 token → tokenUsage 为 null

**Given** 一个运行中的 session，adapter 在该 turn 帧的 `TurnValue.tokens === null`

**When** 客户端读取该 turn 事件的 `tokenUsage` 字段

**Then**

- `tokenUsage` 字段存在且值为 `null`
- **不得**输出 `{input:0, output:0, cached:0}`

```json
{
  "id": 0,
  "role": "assistant",
  "content": "pong",
  "toolCalls": [],
  "tokenUsage": null,
  "durationMs": 47,
  "timestamp": "2026-06-30T02:19:18.903Z"
}
```

---

## Scenario 3: 会话累计 tokenUsage 不被 null turn 污染

**Given** host 在 `trackTurn`（`session-manager.ts:787-798`）按 turn 累加
`runtime.tokenUsage`

**When** 某个 turn 的 `tokens === null`

**Then**

- 该 turn **不参与**累加（`runtime.tokenUsage` 维持原值），与现有 `if (turn.tokens !== null)`
  守卫一致
- 后续 `exit` 事件中的 `ExitSignal.tokenUsage`（`core/types.ts:42-55`）反映已知 token 之和，
  不被 null turn 写成 0

---

## 验收清单（对应 #178）

- [ ] adapter 带 token 时，turn 事件 `tokenUsage` 原样透传
- [ ] adapter 未带 token 时，turn 事件 `tokenUsage === null`（不是 `{0,0,0}`）
- [ ] `wire-turn.ts` 不再用 `EMPTY_TOKEN_USAGE` 兜底 assistant turn 的 `tokenUsage`
- [ ] `AssistantTurn.tokenUsage` 类型放宽为 `TokenUsage | null`
- [ ] 累计逻辑对 `null` turn 跳过，不污染 exit 的 tokenUsage

源码参考：`packages/host/src/wire-turn.ts:10,25-59`、
`packages/host/src/session-manager.ts:787-798`、
`packages/core/src/types.ts:6-10,42-55,74-82`、
`packages/adapter-core/src/wire-types.ts:19-26`
