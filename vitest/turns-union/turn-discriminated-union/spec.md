---
scenario: Turn 辨别联合类型定义
feature: Turn = AssistantTurn | ToolTurn
tags: [turns, types, discriminated-union]
---

# Turn 辨别联合类型

Turn 是一个以 `role` 字段为判别器的辨别联合（discriminated union），分为 `assistant` 和 `tool` 两种变体。

## 背景

每次 LLM 推理产生一条 `AssistantTurn`，每次工具执行产生一条 `ToolTurn`。两者共享基础字段 `id`、`durationMs`、`timestamp`，通过 `role` 字段区分类型。

---

## Scenario: AssistantTurn 结构

**Given** LLM 完成一次推理

**Then** 产生一条 AssistantTurn，结构如下：

```typescript
type AssistantTurn = {
  id: number;
  role: "assistant";
  content: string;
  toolCalls: Array<ToolCall>;
  tokenUsage: TokenUsage;
  durationMs: number;
  timestamp: string;
};
```

**示例 JSON：**

```json
{
  "id": 0,
  "role": "assistant",
  "content": "我来帮你创建这个文件。",
  "toolCalls": [
    {
      "id": "call_abc123",
      "name": "write_file",
      "arguments": { "path": "/tmp/hello.txt", "content": "hello" }
    }
  ],
  "tokenUsage": { "input": 150, "output": 45, "cached": 30 },
  "durationMs": 1200,
  "timestamp": "2026-06-29T10:00:00.000Z"
}
```

---

## Scenario: ToolTurn 结构

**Given** Agent 执行了一次工具调用

**Then** 产生一条 ToolTurn，结构如下：

```typescript
type ToolTurn = {
  id: number;
  role: "tool";
  callId: string;
  name: string;
  result: string;
  durationMs: number;
  timestamp: string;
};
```

**示例 JSON：**

```json
{
  "id": 1,
  "role": "tool",
  "callId": "call_abc123",
  "name": "write_file",
  "result": "File written successfully",
  "durationMs": 45,
  "timestamp": "2026-06-29T10:00:01.200Z"
}
```

---

## Scenario: 通过 role 字段判别类型

**Given** 收到一个 Turn 对象

**When** `turn.role === "assistant"`

**Then** 该对象包含 `content`、`toolCalls`、`tokenUsage` 字段

**When** `turn.role === "tool"`

**Then** 该对象包含 `callId`、`name`、`result` 字段

---

## 关联类型定义

### TokenUsage

```typescript
type TokenUsage = {
  input: number;   // 输入 token 数
  output: number;  // 输出 token 数
  cached: number;  // 缓存命中 token 数
};
```

### ToolCall

```typescript
type ToolCall = {
  id: string;                        // 工具调用唯一标识
  name: string;                      // 工具名称
  arguments: Record<string, unknown>; // 调用参数
};
```

### Turn 联合

```typescript
type Turn = AssistantTurn | ToolTurn;
```

---

## 字段对比

| 字段 | AssistantTurn | ToolTurn |
|------|:---:|:---:|
| `id` | ✓ | ✓ |
| `role` | `"assistant"` | `"tool"` |
| `content` | ✓ | ✗ |
| `toolCalls` | ✓ | ✗ |
| `tokenUsage` | ✓ | ✗ |
| `callId` | ✗ | ✓ |
| `name` | ✗ | ✓ |
| `result` | ✗ | ✓ |
| `durationMs` | ✓ | ✓ |
| `timestamp` | ✓ | ✓ |

源码参考：`packages/core/src/types.ts`（第 69–92 行）
