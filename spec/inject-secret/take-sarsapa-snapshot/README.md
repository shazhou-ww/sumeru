# 对 Sarsapa Session 创建 Snapshot

## Precondition

- Session 已创建（由父节点 `inject-secret` 创建）
- SID 存储在 `/tmp/inject_session_id`

## Postcondition

- Snapshot `sarsapa-snapshot` 被成功创建

## 验证方法

```bash
SID=$(cat /tmp/inject_session_id) && sumeru session snapshot $SID sarsapa-snapshot
# 期望: Snapshot created | Exit code: 0
```

## 父节点

- [inject-secret](../README.md)
