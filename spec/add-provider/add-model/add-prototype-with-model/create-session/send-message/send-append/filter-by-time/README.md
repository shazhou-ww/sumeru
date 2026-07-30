# 限制查询结果数量

## Precondition

- Session 已有多轮对话
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 返回最多 `--limit 10` 条 turns

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID --limit 10 --format json
# 期望: 返回 turns 或 empty
```

## 父节点

- [send-append](../README.md)
