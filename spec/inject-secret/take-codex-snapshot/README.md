# 对 Codex Session 创建 Snapshot

## Precondition

- Provider `openai-provider` + Model `gpt-model` 已创建
- Prototype `codex-proto`（adapter=codex）已创建
- Session 已创建并处理了 secret code 任务
- SID 存储在 `/tmp/codex_session_id`

## Postcondition

- Snapshot `codex-snapshot` 被成功创建

## 验证方法

```bash
SID=$(cat /tmp/codex_session_id) && sumeru session snapshot $SID codex-snapshot
# 期望: Snapshot created | Exit code: 0
```

## 父节点

- [inject-secret](../README.md)
