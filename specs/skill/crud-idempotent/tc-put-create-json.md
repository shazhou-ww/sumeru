---
id: tc-put-create-json
spec: crud-idempotent
tags: [e2e, skill, crud, create, json]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Skill "test-skill" does NOT exist (clean state)
---

# PUT Create Skill: JSON Body

验证 PUT /skills/:name 以 JSON body 创建新 skill 返回 200 + 正确的响应体。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确保目标 skill 不存在（清理残留）：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/skills/test-skill
   ```

## Steps

1. 创建 skill：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/skills/test-skill \
     -H 'Content-Type: application/json' \
     -d '{"content": "# Test Skill\n\nThis is a test skill."}'
   ```
   → 返回 200 + skill 对象

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 1 `type` = `@sumeru/skill`
- [ ] Step 1 `value.name` = `test-skill`
- [ ] Step 1 `value.content` 包含 `# Test Skill`

## Failure Signals

- 返回 400 → 请求体格式有误，检查 Content-Type 和 JSON 结构
- 返回 404 → 路由不存在，检查 skill CRUD 是否已实现
