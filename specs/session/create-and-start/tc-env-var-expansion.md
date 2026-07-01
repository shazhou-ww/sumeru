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
   name: test-env-host
   maxRunning: 2
   workspaceRoot: /tmp/projects
   envFile: ${ENV_FILE_PATH:-.env}
   EOF
   ```

2. 设置环境变量并启动 host：
   ```bash
   export ENV_FILE_PATH="/custom/path/.env"
   SUMERU_PORT=7902 npx tsx packages/host/src/main.ts /tmp/test-env-expand
   ```

## Steps

1. 确认 host 启动成功：
   ```bash
   curl -s http://127.0.0.1:7902/
   ```
   → 应返回 status 正常（不是 YAML parse error）

2. 确认 host 能正常创建 session（envFile 展开正确）：
   ```bash
   curl -s http://127.0.0.1:7902/ | jq '.value.name'
   ```
   → 应返回 `test-env-host`

## Expected

- [ ] Step 1 host 正常启动，不抛 "undefined variable" 或 YAML parse 错误
- [ ] Step 2 host name 正确展示

## Variant: Fallback Default

若 `ENV_FILE_PATH` 未设置：

1. `unset ENV_FILE_PATH` 后重启 host
2. 重复 Steps
3. **Expected**: envFile 使用默认值 `.env`

## Variant: Missing Required Var

若 host.yaml 中引用 `${REQUIRED_VAR}`（无 `:-` 默认值）且该变量未设置：

1. `unset REQUIRED_VAR` 后重启 host
2. **Expected**: host 启动时抛出 "Environment variable REQUIRED_VAR not found" 错误

## Failure Signals

- host.yaml 中 `${...}` 原样出现在 config → expandEnvVars 未被调用
- host 启动报 YAML parse error → expandEnvVars 在 YAML parse 之后调用（顺序错误）
- fallback 不生效 → `:-` 语法解析有 bug
