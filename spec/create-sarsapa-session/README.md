# 创建 Sarsapa Session（协议验证）

## Precondition

- Server 正在运行
- 完整资源链已创建：
  - Provider `test-provider`（apiType=openai）
  - Model `test-model`（provider=test-provider）
  - Prototype `test-proto`（adapter=sarsapa, model=test-model, instructions="You are a helpful assistant"）

## Postcondition

- Sarsapa Session 被创建并处理 task `List the files in current directory`
- SID 存储在 `/tmp/sarsapa_session_id`
- Adapter 按 sarsapa 协议处理请求

## 验证方法

```bash
SID=$(cat /tmp/sarsapa_session_id) && sumeru session get $SID --format json
# 期望: SID=ses_[A-Z0-9]+
```

## 子节点

- [verify-text-only-turn](verify-text-only-turn/README.md) — 验证纯文本轮次处理
- [verify-token-usage](verify-token-usage/README.md) — 验证 token usage 统计
- [verify-wire-tool-call-id](verify-wire-tool-call-id/README.md) — 验证 tool call ID 传递

## 父节点

- [spec 根目录](../README.md)
