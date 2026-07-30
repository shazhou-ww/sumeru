# 分页查询 Turns

## Precondition

- Session 已有多轮对话
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 返回从指定偏移量开始的 turns 子集

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID --after 2 --format json
# 期望: 返回 turns 或 empty
```

## 父节点

- [send-append](../README.md)
