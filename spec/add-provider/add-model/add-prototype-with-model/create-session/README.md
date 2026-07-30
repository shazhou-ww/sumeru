# 创建 Session

## Precondition

- Prototype `test-proto` 已存在（由祖辈节点创建）
- Provider `test-provider`、Model `test-model`、Adapter `sarsapa` 均就绪

## Postcondition

- 新 Session 被创建，状态从 creating → running
- SID 存储在 `/tmp/session_id`
- Adapter 开始处理 task `Say hello`

## 验证方法

```bash
SID=$(cat /tmp/session_id) && sumeru session get $SID --format json
# 期望: "id": "ses_[A-Z0-9]+"
```

## 子节点

- [list-sessions](list-sessions/README.md) — 列出所有 sessions
- [get-session](get-session/README.md) — 获取 session 详情
- [delete-session](delete-session/README.md) — 删除 session
- [execute-commands](execute-commands/README.md) — 执行 session 命令
- [create-without-task](create-without-task/README.md) — 创建无 task 的 idle session
- [create-multiple-sessions](create-multiple-sessions/README.md) — 创建多个 sessions
- [stop-session](stop-session/README.md) — 停止 session
- [send-message](send-message/README.md) — 发送消息

## 父节点

- [add-prototype-with-model](../README.md)
