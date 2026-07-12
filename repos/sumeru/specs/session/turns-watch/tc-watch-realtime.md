---
id: tc-watch-realtime
spec: turns-watch
tags: [e2e, session, turns, watch, happy-path]
prerequisites:
  - Host running
  - sarsapa prototype available (image rebuilt with session persistence)
---

# Watch Realtime: 新消息实时出现在 watch 流中

## Setup

1. 创建 session：
   ```bash
   sumeru session add sarsapa --task "Say hello, my name is Scott"
   ```
   → 保存 session ID 为 `$SID`，等待 task 完成（session 变 idle）

## Steps

1. Terminal A — 启动 watch：
   ```bash
   sumeru session turns $SID -w
   ```
   → 应显示历史 turns：
   ```
   [user] <timestamp>
   Say hello, my name is Scott

   [assistant] <timestamp>
   Hello Scott! ...

   ---
   ```

2. Terminal B — 发新消息：
   ```bash
   sumeru session send $SID "What is my name?"
   ```
   → `accepted message ...`

3. Terminal A — 验证实时推送：
   → 分隔线 `---` 下方应出现：
   ```
   [user] <timestamp>
   What is my name?

   [assistant] <timestamp>
   Your name is Scott!

   [exit] complete:
   ```

4. Ctrl+C 退出 watch

## Verify

- 历史部分在 `---` 上方
- 新消息在 `---` 下方实时出现
- user turn 和 assistant turn 都显示
- watch 进程不自动退出，需 Ctrl+C
