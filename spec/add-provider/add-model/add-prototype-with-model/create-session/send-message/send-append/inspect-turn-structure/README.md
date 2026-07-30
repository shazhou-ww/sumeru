# 检查 Turn 结构（user vs assistant vs tool）

## Precondition

- Session 已有多轮对话（包含 user、assistant、可能的 tool 轮次）
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- turns JSON 包含不同 role 类型的条目

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID --format json
# 期望: 包含 turn / role 字段
```

## 父节点

- [send-append](../README.md)
