---
id: tc-env-var-expansion
spec: create-and-start
tags: [e2e, config, env, host]
prerequisites:
  - Sumeru host running
  - host.yaml uses ${VAR} or ${VAR:-default} syntax in at least one field
  - Referenced env vars are set in host process environment (or envFile)
---

# Environment Variable Expansion in host.yaml

验证 host.yaml 中的 `${VAR}` 和 `${VAR:-default}` 语法在加载时被正确展开。

这是 #175 修复的场景。之前 `expandEnvVars()` 定义了但 `loadHostConfig()` 未调用。

## Setup

1. 创建测试用 host.yaml：
   ```bash
   cat > /tmp/test-env-expand/host.yaml << 'EOF'
   workspaceRoot: /tmp/projects
   envFile: .env
   models:
     anthropic:
       apiKey: ${TEST_API_KEY:-fallback-key-123}
       baseUrl: ${CUSTOM_BASE_URL}
   prototypes:
     - hermes
   EOF
   ```

2. 设置环境变量并启动 host：
   ```bash
   export TEST_API_KEY="sk-real-key-456"
   export CUSTOM_BASE_URL="http://my-proxy:8080"
   SUMERU_PORT=7902 npx tsx packages/host/src/main.ts /tmp/test-env-expand
   ```

## Steps

1. 确认 host 启动成功：
   ```bash
   curl -s http://127.0.0.1:7902/
   ```
   → 应返回 status 正常（不是 YAML parse error）

2. 创建 session 观察实际使用的 apiKey 和 baseUrl（通过容器内 config）：
   ```bash
   curl -s -X POST http://127.0.0.1:7902/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"test","task":"Say hi"}'
   ```

3. 检查容器内 config：
   ```bash
   CID=$(docker ps -l -q)
   docker exec $CID cat /home/node/.hermes/config.yaml
   ```

## Expected

- [ ] Step 1 host 正常启动，不抛 "undefined variable" 或 YAML parse 错误
- [ ] Step 3 config 中 apiKey = `sk-real-key-456`（展开了 TEST_API_KEY，未用 fallback）
- [ ] Step 3 config 中 base_url 含 `my-proxy:8080`（展开了 CUSTOM_BASE_URL）

## Variant: Fallback Default

若 `TEST_API_KEY` 未设置：

1. `unset TEST_API_KEY` 后重启 host
2. 重复 Steps
3. **Expected**: config 中 apiKey = `fallback-key-123`（使用 `:-` 默认值）

## Variant: Missing Required Var

若 `CUSTOM_BASE_URL` 未设置且无 `:-` 默认值：

1. `unset CUSTOM_BASE_URL` 后重启 host
2. **Expected**: host 启动时抛出 "Environment variable CUSTOM_BASE_URL not found" 错误

## Failure Signals

- host.yaml 中 `${...}` 原样出现在 config → expandEnvVars 未被调用
- host 启动报 YAML parse error → expandEnvVars 在 YAML parse 之后调用（顺序错误）
- fallback 不生效 → `:-` 语法解析有 bug
