---
id: tc-snapshot-commit
spec: session-commands
tags: [e2e, session, commands, snapshot, docker, prototype]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session exists and is idle
  - Docker daemon accessible
---

# Snapshot Session into New Prototype Image

验证 snapshot 命令执行 docker commit 并注册为新 prototype。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建 session 并做一些修改（安装包等）：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"sarsapa","project":"test-snapshot","task":"idle"}' | jq -r '.value.id')
   ```

3. 在容器内执行修改（制造 diff）：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions/$SID/commands \
     -H 'Content-Type: application/json' \
     -d '{"type":"exec","command":"touch /workspace/snapshot-marker.txt"}'
   ```

4. 确认当前 prototype 列表：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes | jq '.value[].name'
   ```

## Steps

### Step 1 — Snapshot with name

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"snapshot","name":"my-snapshot-test"}'
```

### Step 2 — Verify prototype registered

```bash
curl -s http://127.0.0.1:7901/prototypes | jq '.value[] | select(.name=="my-snapshot-test")'
```

### Step 3 — Create new session from snapshot prototype

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"my-snapshot-test","project":"test-from-snapshot","task":"verify snapshot"}'
```

### Step 4 — Verify snapshot contains changes

```bash
NEW_SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"my-snapshot-test","project":"verify-snapshot","task":"idle"}' | jq -r '.value.id')

curl -s -X POST http://127.0.0.1:7901/sessions/$NEW_SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"exec","command":"test -f /workspace/snapshot-marker.txt && echo EXISTS"}'
```

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 1 `type` = `@sumeru/command-result`
- [ ] Step 1 `value.command` = `snapshot`
- [ ] Step 1 `value.result.prototype` = `my-snapshot-test`
- [ ] Step 2 prototype 列表中包含 `my-snapshot-test`
- [ ] Step 3 可以使用 snapshot prototype 创建新 session（201）
- [ ] Step 4 新 session 容器内包含 snapshot-marker.txt
- [ ] snapshot 命令为同步响应（200，非 202）

## Failure Signals

- 404 session_not_found → Session $SID 不存在
- 500 internal error → Docker commit 失败，检查 Docker daemon 状态
- 500 prototype registration → Docker image 已创建但 SQLite 注册失败
- Step 3 404 prototype_not_found → Snapshot 注册未完成
- Step 4 文件不存在 → Docker commit 未正确保存容器层
