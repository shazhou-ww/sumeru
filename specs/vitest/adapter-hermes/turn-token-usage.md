---
scenario: adapter-hermes 在 turn 帧上携带 usage_update 的 token，而非只放进 done
feature: "@sumeru/adapter-hermes — TurnValue.tokens"
tags: [adapter, hermes, acp, token-usage, bug-178]
---

# adapter-hermes：turn 帧携带 token usage

`@sumeru/adapter-hermes` 必须把 ACP `usage_update` 上报的 token 数据附加到对应的
per-turn `TurnValue.tokens` 上，使 host 能在 `event: turn` 中透传真实 token 消耗。
当前实现只把 usage 累计到 `done` 帧，导致每个 turn 帧的 `tokens` 恒为 `null`，最终被 host
清零（见 `specs/sse/turn-event-token-usage.md`）。

## 背景（当前 Bug — #178）

`packages/adapter-hermes/src/adapter.ts` 中：

- `mapUpdateToTurns`（`adapter.ts:306-338`）在收到 `usage_update` 时只更新
  `state.usage`（`adapter.ts:327-333`），**返回空数组**，不附加到任何 turn。
- 所有产出的 `TurnValue` 都硬编码 `tokens: null`（`adapter.ts:320,352,364`）。
- `state.usage` 仅在 handle 结束时随 `done` 帧返回（`adapter.ts:239-242`：
  `tokenUsage: state.usage`）。

结果：host 收到的每个 turn 帧 `tokens === null` → `wire-turn.ts` 兜底为 `{0,0,0}`。

```typescript
// adapter.ts:327-333（usage 被吞进 state，未挂到 turn）
if (update.sessionUpdate === "usage_update") {
  state.usage = { input: update.input_tokens, output: update.output_tokens, cached: 0 };
  return [];
}
```

---

## Scenario 1: usage_update 后产出的 turn 携带 token

**Given** 一个 hermes ACP 会话，依次收到：
1. `agent_message_chunk`（累积文本 `"pong"`）
2. `usage_update`（`input_tokens=100, output_tokens=20`）
3. prompt 完成（触发 `flushPending`）

**When** adapter 通过 NDJSON 产出该 assistant turn 帧

**Then** 产出的 `TurnValue` 携带该 turn 的 token，而非 `null`：

```json
{
  "index": 0,
  "role": "assistant",
  "content": "pong",
  "timestamp": "2026-06-30T02:19:18.903Z",
  "toolCalls": null,
  "tokens": { "input": 100, "output": 20, "cached": 0 }
}
```

- `tokens` 为 `TokenUsage`（非 `null`），取自最近一次 `usage_update`
- 该 turn 被 flush（`flushPending`，`adapter.ts:340-368`）时把 `state.usage` 挂到 `tokens`

---

## Scenario 2: 无 usage_update 时 tokens 仍为 null

**Given** 一个 turn 在产出前从未收到 `usage_update`

**When** adapter 产出该 turn 帧

**Then**

- `tokens === null`（如实表达"未知"）
- host 据此输出 `tokenUsage: null`（见 `specs/sse/turn-event-token-usage.md` Scenario 2）

---

## Scenario 3: usage 归属对应的 turn，不重复计入

**Given** 单次 handle 内产生多个 assistant turn，期间收到一次或多次 `usage_update`

**When** adapter 依次产出这些 turn

**Then**

- 每次 `usage_update` 的 token 只归属其后被 flush 的那个 turn，不重复挂到多个 turn
- turn 帧 token 之和应与 `done` 帧 `DoneValue.tokenUsage` 在口径上一致
  （`done` 仍可携带本次 handle 的累计/最终 usage，不与本 spec 冲突）

---

## 验收清单（对应 #178）

- [ ] `usage_update` 后被 flush 的 turn 帧 `tokens` 为实际 `TokenUsage`
- [ ] 从未收到 `usage_update` 的 turn 帧 `tokens === null`
- [ ] usage 不重复计入多个 turn
- [ ] `done` 帧仍可携带累计 `tokenUsage`（行为不回退）

源码参考：`packages/adapter-hermes/src/adapter.ts:179-243,306-368`、
`packages/adapter-hermes/src/types.ts:118-123`、
`packages/adapter-core/src/wire-types.ts:19-31`
