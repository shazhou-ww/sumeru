# 恢复已停止的 Session

## Precondition

- Session 已被停止，状态为 `idle`
- SID 存储在 `/tmp/resume_session_id`

## Postcondition

- 向已停止的 session 发送消息触发恢复
- Session 重新进入运行状态

## 验证方法

```bash
SID=$(cat /tmp/resume_session_id) && sumeru session send $SID 'Continue from where you stopped'
# 期望: Message sent | accepted message
```

## 父节点

- [stop-session](../README.md)
