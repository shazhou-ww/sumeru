---
id: tc-format-consistency
spec: turns-watch
tags: [e2e, session, turns, format]
prerequisites:
  - Host running
  - Session with tool calls exists
---

# Format Consistency: watch 和非 watch 输出格式一致

## Steps

1. 创建 session 并触发 tool call：
   ```bash
   sumeru session add sarsapa --task "Check if cowsay is installed"
   ```
   → 保存 `$SID`，等待完成

2. 非 watch 查看 turns：
   ```bash
   sumeru session turns $SID
   ```

3. watch 模式查看 turns：
   ```bash
   sumeru session turns $SID -w
   # Ctrl+C 退出
   ```

## Verify

两种模式的输出格式一致：
- `[role] <ISO timestamp>` 第一行
- content 第二行起
- assistant + tool call 显示为 `→ tool_name({...})`
- tool result 显示为 `[tool] <timestamp>\ntool_name: result`
- 空行分隔每个 turn
