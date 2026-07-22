---
id: tc-snapshot-context-inherit
spec: snapshot-context-inherit
tags: [e2e, session, snapshot, resume, single-session]
prerequisites:
  - Host running
  - At least one adapter image built (e.g. `sumeru/sarsapa:dev`)
---

# Snapshot Context Inherit: snapshot 后新 session 的上下文继承与隔离

验证"每个 container = 单 session"设计：
- **--skip-reset** 路径：新 session 继承 snapshot image 中的对话历史
- **默认（reset）** 路径：新 session 从干净状态开始，不继承上下文

本 TC 是 adapter 中立的，适用于任何 adapter（sarsapa、claude-code、hermes 等）。
以下用 `$ADAPTER` 指代实际 adapter 名，`$MODEL` 指代可用 model。

## Setup

1. 注册 prototype（如果尚不存在）：
   ```bash
   sumeru prototype add test-base --adapter $ADAPTER --model $MODEL
   ```

2. 创建 session，注入一个可验证的事实：
   ```bash
   SID=$(sumeru session add test-base --task "Remember this: the secret code is ALPHA-7742" | awk '{print $3}')
   ```

3. 等待 task 完成（约 10s），确认 assistant 有响应：
   ```bash
   sumeru session turns $SID
   ```
   → assistant 应回复确认（包含 "ALPHA-7742" 或类似确认语）

4. Snapshot 成新 prototype：
   ```bash
   sumeru session snapshot $SID test-snapshot
   ```
   → 输出 `Snapshot created`

## Path A: --skip-reset（继承上下文）

1. 从 snapshot prototype 创建新 session，跳过 reset：
   ```bash
   SID_A=$(sumeru session add test-snapshot --skip-reset --task "What is the secret code?" | awk '{print $3}')
   ```

2. 等待 task 完成，查看 turns：
   ```bash
   sumeru session turns $SID_A
   ```

### Verify (Path A)

- ✅ assistant 回复**包含** "ALPHA-7742"（上下文继承成功）
- ✅ `$SID` ≠ `$SID_A`（host 侧是不同 session）
- ❌ 不应回复 "I don't know" / "I don't have that information" / "no prior context"

## Path B: 默认 reset（干净状态）

1. 从同一 snapshot prototype 创建新 session，不加 --skip-reset：
   ```bash
   SID_B=$(sumeru session add test-snapshot --task "What is the secret code?" | awk '{print $3}')
   ```

2. 等待 task 完成，查看 turns：
   ```bash
   sumeru session turns $SID_B
   ```

### Verify (Path B)

- ✅ assistant **不知道** secret code（回复 "I don't know" 或类似）
- ✅ 对话上下文被 reset 清除，agent 从干净 persona 开始
- ❌ 不应回复包含 "ALPHA-7742"

## Cleanup

```bash
sumeru session rm $SID
sumeru session rm $SID_A
sumeru session rm $SID_B
sumeru prototype rm test-snapshot
sumeru prototype rm test-base
docker rmi sumeru/test-snapshot:dev 2>/dev/null
```

## Design Notes

- Container 内部是单 session 设计，无 session ID 概念
- `--skip-reset`：host 不发 init frame，adapter 走 `resume()` 路径从持久化存储恢复上下文
- 默认（reset）：host 发 init frame，adapter 执行 `init()` 重建干净 conversation
- 对于 sarsapa：resume 从 session.jsonl 恢复；init 重写 session.jsonl
- 对于 claude-code/codex/cursor-agent：resume 用 native `--resume <id>` 恢复
- Bug history: sarsapa 的 init() 曾在 session.jsonl 存在时覆写导致 --skip-reset 失效，已修复
