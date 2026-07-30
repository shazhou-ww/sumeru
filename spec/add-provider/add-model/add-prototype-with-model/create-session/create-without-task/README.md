# 创建无 Task 的 Session（Idle）

## Precondition

- Prototype `test-proto` 存在
- Provider、Model、Adapter 链就绪

## Postcondition

- Session 被创建，初始状态为 `idle`（不自动发送消息）
- SID 存储在 `/tmp/session_id_2`

## 验证方法

```bash
SID2=$(cat /tmp/session_id_2) && sumeru session get $SID2 --format json
# 期望: status 为 "idle"
```

## 子节点

- [send-to-idle](send-to-idle/README.md) — 向 idle session 发送消息

## 父节点

- [create-session](../README.md)
