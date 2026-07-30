# 按工具类型过滤 Turns

## Precondition

- Session 已有多轮对话
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 返回 turns（含工具调用信息）

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID --format json
# 期望: 包含 turn / role 字段或 empty
```

## 父节点

- [send-append](../README.md)
