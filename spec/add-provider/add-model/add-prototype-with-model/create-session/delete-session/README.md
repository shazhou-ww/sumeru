# 删除 Session

## Precondition

- Session 已存在（SID 存储在 `/tmp/session_id`）

## Postcondition

- Session 被删除或标记为已删除
- 再次 get 该 Session 返回 not found

## 验证方法

```bash
SID=$(cat /tmp/session_id) && sumeru session remove $SID
# 期望: Removed | removed | deleted
```

## 父节点

- [create-session](../README.md)
