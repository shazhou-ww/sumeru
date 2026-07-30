# 对 Hermes Session 创建 Snapshot

## Precondition

- Provider `hermes-provider` + Model `hermes-model` 已创建
- Prototype `hermes-proto`（adapter=hermes）已创建
- Session 已创建并处理了 secret code 任务
- SID 存储在 `/tmp/hermes_session_id`

## Postcondition

- Snapshot `hermes-snapshot` 被成功创建

## 验证方法

```bash
SID=$(cat /tmp/hermes_session_id) && sumeru session snapshot $SID hermes-snapshot
# 期望: Snapshot created | Exit code: 0
```

## 父节点

- [inject-secret](../README.md)
