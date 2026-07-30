# 列出所有 Turns

## Precondition

- Session 已有多轮对话（由父节点链创建）
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 返回完整的 turns 历史（user + assistant）

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID --format json
# 期望: 包含 turn / role 字段
```

## 父节点

- [send-append](../README.md)
