# 注入 Secret Code 到 Session

## Precondition

- Server 正在运行
- 完整资源链已创建（provider → model → prototype，adapter=sarsapa）

## Postcondition

- Session 被创建并处理 task `Remember this secret code: ALPHA-7742. Reply OK.`
- SID 存储在 `/tmp/inject_session_id`
- Secret code 被注入到 session 的对话历史中
- 各 adapter 类型的 snapshot 可基于此 session 创建

## 验证方法

```bash
SID=$(cat /tmp/inject_session_id) && sumeru session get $SID --format json
# 期望: SID=ses_[A-Z0-9]+
```

## 子节点

- [take-claude-code-snapshot](take-claude-code-snapshot/README.md) — 对 claude-code session 创建 snapshot
- [take-codex-snapshot](take-codex-snapshot/README.md) — 对 codex session 创建 snapshot
- [take-cursor-agent-snapshot](take-cursor-agent-snapshot/README.md) — 对 cursor-agent session 创建 snapshot
- [take-hermes-snapshot](take-hermes-snapshot/README.md) — 对 hermes session 创建 snapshot
- [take-sarsapa-snapshot](take-sarsapa-snapshot/README.md) — 对 sarsapa session 创建 snapshot

## 父节点

- [spec 根目录](../README.md)
