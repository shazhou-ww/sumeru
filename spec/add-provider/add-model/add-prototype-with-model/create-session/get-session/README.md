# 获取 Session 详情

## Precondition

- Session 已存在（SID 存储在 `/tmp/session_id`）

## Postcondition

- 返回 Session 的完整详情（id, status, prototype 等）

## 验证方法

```bash
SID=$(cat /tmp/session_id) && sumeru session get $SID --format json
# 期望: 包含 "id": "ses_..."
```

## 父节点

- [create-session](../README.md)
