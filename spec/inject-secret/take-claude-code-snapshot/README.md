# 对 Claude Code Session 创建 Snapshot

## Precondition

- Provider `claude-provider` + Model `claude-model` 已创建
- Prototype `claude-proto`（adapter=claude-code）已创建
- Session 已创建并处理了 secret code 任务
- SID 存储在 `/tmp/claude_session_id`

## Postcondition

- Snapshot `claude-snapshot` 被成功创建
- 包含 session 的完整状态

## 验证方法

```bash
SID=$(cat /tmp/claude_session_id) && sumeru session snapshot $SID claude-snapshot
# 期望: Snapshot created | Exit code: 0
```

## 父节点

- [inject-secret](../README.md)
