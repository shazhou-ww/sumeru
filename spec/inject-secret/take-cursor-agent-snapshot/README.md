# 对 Cursor Agent Session 创建 Snapshot

## Precondition

- Provider `cursor-provider` + Model `cursor-model` 已创建
- Prototype `cursor-proto`（adapter=cursor-agent）已创建
- Session 已创建并处理了 secret code 任务
- SID 存储在 `/tmp/cursor_session_id`

## Postcondition

- Snapshot `cursor-snapshot` 被成功创建

## 验证方法

```bash
SID=$(cat /tmp/cursor_session_id) && sumeru session snapshot $SID cursor-snapshot
# 期望: Snapshot created | Exit code: 0
```

## 父节点

- [inject-secret](../README.md)
