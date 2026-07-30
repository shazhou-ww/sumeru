# 实时监控 Turns（--watch）

## Precondition

- Session 已有多轮对话
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- `--watch` 模式持续输出新的 turn 事件
- 超时 3 秒后自动退出

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && timeout 3 sumeru session turns $SID --watch
# 期望: 输出 user/assistant 内容，或 Terminated
```

## 父节点

- [send-append](../README.md)
