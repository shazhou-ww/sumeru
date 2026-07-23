---
tc: init 时写入 AGENTS.md 和 skills 到工作目录
spec: adapter-codex-stream-parser
tags: [adapter, codex, e2e, init, scaffold]
status: PASS
---

# TC: init → AGENTS.md + skills scaffold

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `codex` available
- Docker image 的 home 目录可检查（或通过 session 的 task 验证）

## Steps

1. **创建 session（验证 init scaffold 存在的任务）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"codex","project":"sumeru","task":"Print the content of AGENTS.md file in your working directory. If it does not exist, say FILE_NOT_FOUND."}' \
  | jq -r '.value.id')
echo "Session: $SID"
```

2. **等待 session idle**：

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
```

3. **检查 assistant turn 的 content**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq -r '.value[] | select(.role=="assistant") | .content' | tail -1
```

## Expected

- [ ] assistant turn 的 content 包含 AGENTS.md 的内容（不是 "FILE_NOT_FOUND"）
- [ ] AGENTS.md 内容中包含 "skill" 或项目相关指令（由 init 生成）

## Failure Signals

- content 包含 "FILE_NOT_FOUND" → adapter.init() 没有写入 AGENTS.md
- session error → codex CLI 启动失败
- AGENTS.md 为空 → init 写入逻辑有 bug
