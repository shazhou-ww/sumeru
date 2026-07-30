# 向 Idle Session 发送消息

## Precondition

- Session 已创建且处于 `idle` 状态（SID 存储在 `/tmp/session_id_2`）
- Adapter 已就绪

## Postcondition

- 消息被成功发送并处理
- Session 状态从 idle 转为 running → idle

## 验证方法

```bash
SID2=$(cat /tmp/session_id_2) && sumeru session send $SID2 'Hello idle session'
# 期望: Message sent | accepted message
```

## 父节点

- [create-without-task](../README.md)
