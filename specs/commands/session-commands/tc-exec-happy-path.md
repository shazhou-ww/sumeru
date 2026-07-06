---
id: tc-exec-happy-path
spec: session-commands
tags: [e2e, session, commands, exec, happy-path]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session "sess-001" exists and is idle
---

# Happy Path: Exec Shell Command in Container

验证通过 exec 命令在容器内执行 shell 命令，返回 stdout/stderr/exitCode。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建并等待 session 就绪：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"sarsapa","project":"test-exec","task":"idle"}' | jq -r '.value.id'
   ```
   → 保存返回的 `value.id` 为 `$SID`

## Steps

### Step 1 — exec with stdout output

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"exec","command":"echo hello world"}'
```

### Step 2 — exec with exit code 0

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"exec","command":"ls -la /workspace"}'
```

### Step 3 — exec with stderr and non-zero exit code

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"exec","command":"ls /nonexistent-path"}'
```

### Step 4 — exec multi-line output

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"exec","command":"echo line1 && echo line2 && echo line3"}'
```

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 1 `type` = `@sumeru/command-result`
- [ ] Step 1 `value.command` = `exec`
- [ ] Step 1 `value.result.output` 包含 `hello world`
- [ ] Step 2 返回 HTTP 200
- [ ] Step 2 `value.result.output` 包含目录列表内容
- [ ] Step 3 返回 HTTP 200
- [ ] Step 3 `value.result.output` 包含错误信息（No such file or directory）
- [ ] Step 4 返回 HTTP 200
- [ ] Step 4 `value.result.output` 包含多行输出（line1, line2, line3）
- [ ] 所有响应 `type` = `@sumeru/command-result`
- [ ] exec 命令为同步响应（200，非 202）

## Failure Signals

- 404 session_not_found → Session $SID 不存在或已销毁
- 500 internal error → Docker exec 调用失败，检查容器是否在运行
- 超时无响应 → 容器内 shell 挂起，检查容器健康状态
