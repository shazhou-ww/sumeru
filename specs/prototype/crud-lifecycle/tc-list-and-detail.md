---
id: tc-list-and-detail
spec: crud-lifecycle
tags: [e2e, prototype, read]
prerequisites:
  - Sumeru host running (port 7901)
  - At least one prototype exists (e.g. seed data or prior create)
---

# List & Detail: Read Operations

验证 GET 端点能正确列出全部 prototype 以及获取单个详情，包含 404 路径。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确保测试 prototype 存在：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-read-alpha \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-read-alpha",
       "instructions": "Alpha agent for read tests.",
       "skills": [],
       "defaults": null
     }'
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-read-beta \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-read-beta",
       "instructions": "Beta agent for read tests.",
       "skills": ["git"],
       "defaults": { "maxTurns": 10, "timeout": 120, "resources": { "cpu": 1, "memory": "1Gi" } }
     }'
   ```

## Steps

1. 列出所有 prototype：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes | jq .
   ```
   → 返回包含 tc-read-alpha 和 tc-read-beta 的列表

2. 获取单个 prototype 详情：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/tc-read-alpha | jq .
   ```
   → 返回 tc-read-alpha 完整信息

3. 获取不存在的 prototype：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7901/prototypes/nonexistent-ghost
   ```
   → 返回 404

4. 获取不存在的 prototype 错误体：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/nonexistent-ghost | jq .
   ```
   → 返回 error 结构

## Expected

- [ ] Step 1 返回 HTTP 200，`type` = `@sumeru/prototype-list`
- [ ] Step 1 `value` 数组包含 `tc-read-alpha` 和 `tc-read-beta`
- [ ] Step 2 返回 HTTP 200，`type` = `@sumeru/prototype`
- [ ] Step 2 `value.name` = `tc-read-alpha`，`value.instructions` = `"Alpha agent for read tests."`
- [ ] Step 3 返回状态码 `404`
- [ ] Step 4 `type` = `@sumeru/error`，`value.error` = `prototype_not_found`

## Failure Signals

- 列表为空 → prototype 目录可能未初始化或 seed 数据缺失
- 详情返回 404 → Setup 中 POST 创建可能失败，检查返回码
- 返回 500 → 检查 host 日志中的文件系统权限错误
