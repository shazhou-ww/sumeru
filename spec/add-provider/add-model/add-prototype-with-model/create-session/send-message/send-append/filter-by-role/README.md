# 按偏移量查询 Turns

## Precondition

- Session 已有多轮对话
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 返回从 `--offset 0` 开始的 turns

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID --offset 0 --format json
# 期望: 包含 turn / role 字段或 empty
```

## 父节点

- [send-append](../README.md)
