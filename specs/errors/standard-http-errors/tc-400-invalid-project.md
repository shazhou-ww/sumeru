---
id: tc-400-invalid-project
spec: standard-http-errors
tags: [e2e, errors, 400, validation, path-traversal, security]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - workspaceRoot configured as /home/azureuser/repos
---

# 400 Invalid Project — Path Traversal Blocked

验证 POST /sessions 中 project 路径包含目录遍历时返回 400 invalid_project。

## Setup

无额外 setup。Host 的 workspaceRoot=/home/azureuser/repos，路径遍历攻击应被拦截。

## Steps

1. 使用路径遍历的 project：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "prototype": "hermes",
       "project": "../../etc/passwd",
       "task": "hack"
     }'
   ```
   → 应返回 400

2. 验证错误码为 invalid_project：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "prototype": "hermes",
       "project": "../../etc/passwd",
       "task": "hack"
     }' | jq '.value.error'
   ```
   → 应返回 `"invalid_project"`

3. 验证错误消息包含路径相关描述：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "prototype": "hermes",
       "project": "../../etc/passwd",
       "task": "hack"
     }' | jq '.value.message'
   ```
   → 应包含 "escapes" 或 "workspace" 相关描述

## Expected

- [ ] HTTP 状态码为 400
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"invalid_project"`
- [ ] `.value.message` 包含路径安全相关错误描述

## Failure Signals

- 返回 201 → 路径校验缺失，严重安全隐患
- 返回 404 → prototype 先行校验未通过（可能 hermes prototype 不存在）
- 返回 500 → resolveProjectPath() 抛出异常但未被正确处理
