# 停止 Session

## Precondition

- 新建 Session（task='Stop test'）并等待运行
- SID 存储在 `/tmp/stop_session_id`

## Postcondition

- Session 状态变为 `idle`（已停止）
- Session 可被恢复或清理

## 验证方法

```bash
SID=$(cat /tmp/stop_session_id) && sumeru session get $SID --format json
# 期望: "status": "idle"
```

## 子节点

- [resume-session](resume-session/README.md) — 恢复已停止的 session

## 父节点

- [create-session](../README.md)
