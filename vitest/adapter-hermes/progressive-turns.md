---
scenario: adapter-hermes 利用 ACP 流式事件渐进式 emit turns，而非把整个 agent loop 压成一个 assistant turn
feature: "@sumeru/adapter-hermes — progressive turn streaming"
tags: [adapter, hermes, acp, turns, streaming, tool-turn, bug-182]
---

# adapter-hermes：渐进式 emit turns（ACP 流式）

`@sumeru/adapter-hermes` 必须把 Hermes ACP 会话的 `assistant→tool→assistant…` 过程
**渐进式**地拆成多个 `TurnValue` 帧产出，使 host 的 SSE 流能实时推送每个 turn event。
当前实现把整个 agent loop 压缩成**一个 assistant turn**，中间的 tool 调用与 tool 结果
全部丢失或被错误归属。

## 背景（当前 Bug — #182）

`packages/adapter-hermes/src/adapter.ts` 中：

- 收到 `tool_call` 时（`adapter.ts:311-328`）：flush 当前 pending text 为一个
  **`toolCalls: null`** 的 assistant turn，然后把该 tool call **推入
  `state.pendingToolCalls`**，留给*之后*某次 flush。结果是 tool call 被归属到了
  **错误的（后一个）** assistant turn，而触发它的那段 text 反而不带 toolCalls。
- 从不产出独立的 `role: "tool"` turn —— `mapUpdateToTurns` 只处理
  `agent_message_chunk` / `tool_call` / `usage_update` 三种事件。
- `acp-client.ts`（`parseSessionUpdate`，`acp-client.ts:242-281`）**根本不解析**
  `tool_result`（以及终止用的 `done` / stop）事件 —— tool 执行结果对 adapter 不可见。
- `mapToolCall`（`adapter.ts:388-398`）把 `output / durationMs / exitCode` 全部
  硬编码为 `null`，因此即便走 host 的 `WireToolCall.output → ToolTurn` 兜底路径，
  也永远不会派生出 tool turn（host `wire-turn.ts:78` 要求 `output !== null`）。

结果：用户通过 SSE 只能看到**最终结果**，看不到中间的 assistant 思考与 tool 执行过程；
`specs/turns/turn-discriminated-union/tc-tool-turn-fields.md` 因此被标记为
`NOT_APPLICABLE (adapter-hermes)`。

### 期望的事件 → turn 映射

| ACP 事件 | adapter 动作 |
|----------|--------------|
| `agent_message_chunk` (text_delta) | 累积 `pendingText`，不产出 |
| `tool_call` | **flush** `pendingText` 为 assistant turn（`toolCalls` 含本次调用）→ 产出 |
| `tool_result` | 产出独立的 `role: "tool"` turn（`name / callId / result / durationMs`） |
| `agent_message_chunk` (text_delta) | 累积 `pendingText` |
| `done` / prompt 完成 | **flush** 剩余 `pendingText` 为 final assistant turn |

> 类型支撑：wire `TurnValue`（`packages/adapter-core/src/wire-types.ts:19-31`）当前只支持
> `role: "user" | "assistant" | "system"`，**没有 `role: "tool"` 变体**，无法在 NDJSON
> 边界表达 tool turn。本 spec 要求 wire `TurnValue` 增加 tool 变体，字段为
> `{ index, role: "tool", name, callId, result, durationMs, timestamp }`（与 issue #182 第 2 条、
> 以及 `specs/turns/turn-discriminated-union` 中 `ToolTurn` 的语义一致）。

---

## Scenario 1: tool_call 把前序 text flush 为带 toolCalls 的 assistant turn

**Given** 一个 hermes ACP 会话，依次收到：
1. `agent_message_chunk`（text = `"让我查看一下..."`）
2. `tool_call`（`toolCallId = "tc_1"`，`name = "terminal"`，`input = { command: "ls /tmp" }`）

**When** adapter 处理到 `tool_call` 事件

**Then** 立即产出**一个** assistant `TurnValue`，把前序 pending text 与本次 tool call
**绑定在同一帧**：

```json
{
  "index": 0,
  "role": "assistant",
  "content": "让我查看一下...",
  "timestamp": "<ISO>",
  "toolCalls": [
    { "tool": "terminal", "input": { "command": "ls /tmp" }, "output": null, "durationMs": null, "exitCode": null }
  ],
  "tokens": null
}
```

- `content` 为触发该 tool call 的那段 text（不是后一段）
- `toolCalls` **非 `null`**，包含本次 `tool_call`
- 该 tool call **不再**被推迟归属到之后的 assistant turn

---

## Scenario 2: tool_result 产出独立的 role:"tool" turn

**Given** 在 Scenario 1 之后，会话收到：
3. `tool_result`（`toolCallId = "tc_1"`，`result = "file1.txt file2.txt"`，`durationMs = 150`）

**When** adapter 处理到 `tool_result` 事件

**Then** 产出**一个独立的** `role: "tool"` `TurnValue`：

```json
{
  "index": 1,
  "role": "tool",
  "name": "terminal",
  "callId": "tc_1",
  "result": "file1.txt file2.txt",
  "durationMs": 150,
  "timestamp": "<ISO>"
}
```

- 是**单独一帧**，紧跟在对应的 assistant turn 之后
- `callId` 与 Scenario 1 中 tool call 的 `toolCallId` 对应（`"tc_1"`）
- 不携带 `content`、`toolCalls`、`tokens`（tool turn 专有字段集）
- `acp-client.ts` 的 `parseSessionUpdate` 必须新增对 `tool_result` 事件的解析

---

## Scenario 3: done 把剩余 text flush 为 final assistant turn

**Given** 在 Scenario 2 之后，会话收到：
4. `agent_message_chunk`（text = `"目录下有 file1.txt 和 file2.txt"`）
5. prompt 完成（ACP `done` / stop）

**When** adapter 在 prompt 完成时 flush 剩余 pending text

**Then** 产出 final assistant `TurnValue`：

```json
{
  "index": 2,
  "role": "assistant",
  "content": "目录下有 file1.txt 和 file2.txt",
  "timestamp": "<ISO>",
  "toolCalls": null,
  "tokens": null
}
```

- 这是最后一段 text，独立成帧（不与前面的 turn 合并）

---

## Scenario 4: 完整渐进序列的顺序与数量

**Given** 一次 handle 内按 Scenario 1→2→3 的顺序收到全部事件

**When** 消费 `adapter.handle()` 产出的全部 `TurnValue` 帧

**Then** 恰好产出 **3 个 turn**，顺序为：

| # | role | 关键内容 |
|---|------|----------|
| 0 | `assistant` | `content="让我查看一下..."`，`toolCalls=[terminal]` |
| 1 | `tool` | `name="terminal"`，`result="file1.txt file2.txt"`，`durationMs=150` |
| 2 | `assistant` | `content="目录下有 file1.txt 和 file2.txt"` |

- **不**把三者压缩成一个 assistant turn
- `index` 单调递增（0,1,2），跨 handle 调用保持递增（沿用 `state.nextIndex` / `nextTurnIndex`）

---

## Scenario 5: 多轮 tool 调用（loop）逐轮 emit

**Given** 一次 handle 内发生两轮 tool 循环：
`text_a → tool_call(A) → tool_result(A) → text_b → tool_call(B) → tool_result(B) → text_c → done`

**When** 消费全部产出帧

**Then** 按时间顺序产出 5 帧：
`assistant(text_a, toolCalls=[A]) → tool(A) → assistant(text_b, toolCalls=[B]) → tool(B) → assistant(text_c)`

- 每一轮的 assistant turn 只携带**本轮**的 tool call，不串台
- 每个 tool_result 紧跟其对应的 assistant turn

---

## Scenario 6: 纯文本回复（无 tool）行为不回退

**Given** 一次 handle 内只收到 `agent_message_chunk("pong")` 后 prompt 完成（无任何 tool 事件）

**When** 消费产出帧

**Then**

- 恰好产出 **1 个** assistant turn，`content = "pong"`，`toolCalls = null`
- 与现有 `tests/adapter.test.ts` 的 "yields streaming assistant turns" 行为一致（不回退）
- token usage 归属仍遵循 `specs/adapter/adapter-hermes-turn-token-usage.md`（#178），与本 spec 不冲突

---

## Scenario 7: 端到端 —— host SSE 流逐个推送 turn event

**Given** host 通过 `GET /sessions/:id/events` 订阅一个触发 tool 使用的 session
（事件序列同 Scenario 1→3）

**When** adapter 渐进式产出上述 3 个 wire `TurnValue` 帧

**Then** host 依次发出 **3 个 `event: turn`** SSE 事件，public `Turn` 形态为：

1. `AssistantTurn`：`role:"assistant"`，`content:"让我查看一下..."`，`toolCalls` 含 `terminal`
2. `ToolTurn`：`role:"tool"`，`callId:"tc_1"`，`name:"terminal"`，`result:"file1.txt file2.txt"`，`durationMs:150`
3. `AssistantTurn`：`role:"assistant"`，`content:"目录下有 file1.txt 和 file2.txt"`

- `ToolTurn` 结构符合 `specs/turns/turn-discriminated-union/spec.md` 的字段定义
- host `wire-turn.ts` 必须能把 wire 的 `role:"tool"` 帧透传为 public `ToolTurn`
  （而非仅靠 `WireToolCall.output` 兜底派生）
- 用户在 SSE 上**实时**看到 assistant → tool → assistant 三段，而非只看到最终一段

---

## Scenario 8: 其他 adapter 一致性核查（#182 第 3 条）

**Given** `claude-code` / `codex` / `sarsapa` 三个 adapter

**When** 审查它们的 tool 事件 → turn 映射

**Then**

- `adapter-claude-code`：`stream-parser.ts` 在 `tool_result` 时回填
  `WireToolCall.output`（`stream-parser.ts:177`），host 已能派生 tool turn —— **不回退**
- `adapter-codex`：`stream-parser.ts` 设置 `output: aggregated_output`
  （`stream-parser.ts:78`），host 已能派生 tool turn —— **不回退**
- `sarsapa`：确认其 agent loop 在工具执行后也能让 host 产出 `role:"tool"` turn
  （内部 `LlmRole:"tool"` 仅用于 LLM 上下文，需确认是否同样透传到 wire/SSE）
- 若统一改为 wire 层 `role:"tool"` 帧，需保证上述 adapter 的既有用例与 SSE 形态不破坏

---

## 验收清单（对应 #182）

- [ ] 收到 `tool_call`：flush 的 assistant turn 的 `toolCalls` **含**本次调用（不为 `null`），
      且 `content` 为触发它的前序 text
- [ ] 收到 `tool_result`：产出独立 `role:"tool"` turn，含 `name / callId / result / durationMs`
- [ ] 收到 `done`：flush 剩余 text 为 final assistant turn
- [ ] 完整 loop 产出 [assistant(toolCalls) → tool → assistant]，**不**压成一个 turn
- [ ] `acp-client.ts` 新增解析 `tool_result`（及终止事件）
- [ ] wire `TurnValue` 支持 `role:"tool"` 变体；host `wire-turn.ts` 能透传为 public `ToolTurn`
- [ ] 纯文本回复仍只产出 1 个 assistant turn（#178 token 归属行为不回退）
- [ ] `tc-tool-turn-fields.md` 由 `NOT_APPLICABLE` 变为可测试
- [ ] claude-code / codex / sarsapa 的 tool turn 行为不回退

源码参考：
`packages/adapter-hermes/src/adapter.ts:179-245,307-398`、
`packages/adapter-hermes/src/acp-client.ts:242-281`、
`packages/adapter-hermes/src/types.ts:43-58,118-127`、
`packages/adapter-core/src/wire-types.ts:11-31`、
`packages/host/src/wire-turn.ts:17-91`、
`packages/core/src/types.ts:87-96`（`ToolTurn` 公开类型）
