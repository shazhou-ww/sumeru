---
scenario: SSE turn 事件的 durationMs 反映该 turn 的真实墙钟耗时
feature: GET /sessions/:id/events — AssistantTurn.durationMs
tags: [sse, turns, duration, host, wire-turn, bug-178]
---

# SSE turn 事件：durationMs 为墙钟耗时（正整数）

`event: turn` 推送的 `AssistantTurn.durationMs` 必须表示**该 turn 从开始到 adapter
返回的真实墙钟毫秒数**，而不是该 turn 内工具调用耗时之和。即使一次推理没有任何工具调用
（纯文本回复，如 `"pong"`），`durationMs` 也必须为正整数。

## 背景（当前 Bug — #178）

`packages/host/src/wire-turn.ts` 组装 `AssistantTurn` 时：

```typescript
// wire-turn.ts:47（当前实现）
durationMs: sumToolDuration(wire.toolCalls),
```

`sumToolDuration()`（`wire-turn.ts:97-106`）只累加各 `WireToolCall.durationMs`：

```typescript
function sumToolDuration(toolCalls: Array<WireToolCall> | null): number {
  if (toolCalls === null) return 0;
  let total = 0;
  for (const call of toolCalls) {
    if (call.durationMs !== null) total += call.durationMs;
  }
  return total;
}
```

因此一次没有工具调用的 assistant turn → `durationMs = 0`，违反
`specs/sse/turn-exit-heartbeat`（Scenario 1）中 `durationMs` 为正整数的约定。

> 注意：wire 层 `TurnValue`（`packages/adapter-core/src/wire-types.ts:19-26`）**不携带**任何
> 时长字段，只有 `timestamp`。墙钟耗时必须由 host 在收帧时测量，或由 wire 帧新增时长字段携带。

---

## Scenario 1: 纯文本回复（无工具调用）的 durationMs 为正整数

**Given** 一个运行中的 session，agent 回复一句纯文本（如 `"pong"`），无任何工具调用

**When** host 在 `handleAdapterFrame`（`session-manager.ts:400-414`）收到 `type:"turn"` 帧并经
`wireTurnsToV3` 映射后通过 SSE 推送：

```bash
curl -s -N --max-time 60 -H 'Accept: text/event-stream' \
  "http://127.0.0.1:7901/sessions/$SID/events" > /tmp/sse-output.txt
grep -A1 '^event: turn' /tmp/sse-output.txt | grep '^data:' | head -1 \
  | sed 's/^data: //' | jq '.durationMs'
```

**Then** 输出的 `AssistantTurn` 满足：

```json
{
  "id": 0,
  "role": "assistant",
  "content": "pong",
  "toolCalls": [],
  "durationMs": 47,
  "timestamp": "2026-06-30T02:19:18.903Z"
}
```

- `durationMs` 为**整数且 ≥ 1**（绝不能是 `0`）
- `durationMs` 反映墙钟耗时，**与是否存在工具调用无关**

---

## Scenario 2: durationMs 是墙钟差值，而非工具耗时之和

**Given** 一次 assistant turn，其工具调用耗时之和为 `T_tools`（可能为 0），墙钟耗时为 `T_wall`

**When** host 组装该 turn 的 `durationMs`

**Then**

- `durationMs == T_wall`（墙钟），**不等于** `T_tools`
- 对于 `toolCalls: []` 的纯文本 turn，`T_tools == 0` 但 `durationMs > 0`
- `durationMs` 至少覆盖 adapter 推理 + 网络往返时间，不应小于其中任一工具调用的 `durationMs`

---

## Scenario 3: durationMs 的派生口径（host 侧测量）

**Given** host 持有 `AdapterRuntime.startedAt`（`session-manager.ts:50`）以及每个 turn 帧到达的时刻

**When** 第 N 个 turn 帧到达

**Then** host 以墙钟差值派生 `durationMs`，取整为正整数：

```
durationMs = max(1, round(arrivalTime(N) - boundary))
  其中 boundary =
    第 1 个 turn：本轮消息被发往 adapter 的时刻（send 起点）
    第 N>1 个 turn：第 N-1 个 turn 的到达时刻
```

- 派生结果必须为 `number`（整数），且恒 `≥ 1`
- 不得再调用 `sumToolDuration()` 作为 assistant turn 的 `durationMs` 来源
- `ToolTurn.durationMs` 仍可来自 `WireToolCall.durationMs`（不在本 spec 范围内）

> 实现可选择在 wire `TurnValue` 上新增 host 可信的时长字段来提升精度；无论采用哪种方式，
> 对外可观测的 `AssistantTurn.durationMs` 契约（整数、≥1、墙钟）保持不变。

---

## 验收清单（对应 #178）

- [ ] 纯文本 `"pong"` 回复的 turn 事件 `durationMs ≥ 1`（不再为 0）
- [ ] `durationMs` 为整数类型
- [ ] `durationMs` 取墙钟差值，与 `sumToolDuration` 无关
- [ ] `wire-turn.ts` 中 assistant turn 的 `durationMs` 不再调用 `sumToolDuration`

源码参考：`packages/host/src/wire-turn.ts:25-59,97-106`、
`packages/host/src/session-manager.ts:50,400-414,787-798`、
`packages/adapter-core/src/wire-types.ts:19-26`
