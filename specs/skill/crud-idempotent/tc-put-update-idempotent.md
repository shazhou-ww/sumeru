---
id: tc-put-update-idempotent
spec: crud-idempotent
tags: [e2e, skill, crud, update, idempotent]
prerequisites:
  - Sumeru host running (port 7901)
  - Skill "test-skill" already exists (from tc-put-create-json)
---

# PUT Update Skill: Idempotent

验证 PUT 已存在的 skill 返回相同的 200 状态码（幂等），且 content 已更新。

## Setup

1. 确保 skill 已存在：
   ```bash
   curl -s -X PUT http://127.0.0.1:7901/skills/test-skill \
     -H 'Content-Type: application/json' \
     -d '{"content": "# Test Skill\n\nOriginal content."}'
   ```

## Steps

1. 更新同一 skill（不同 content）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/skills/test-skill \
     -H 'Content-Type: application/json' \
     -d '{"content": "# Test Skill v2\n\nUpdated content."}'
   ```
   → 返回 200 + 更新后的 skill 对象

2. 验证 content 已更新：
   ```bash
   curl -s http://127.0.0.1:7901/skills/test-skill | jq -r '.value.content'
   ```
   → 返回更新后的内容

## Expected

- [ ] Step 1 返回 HTTP 200（与创建时相同状态码）
- [ ] Step 1 `type` = `@sumeru/skill`
- [ ] Step 1 `value.name` = `test-skill`
- [ ] Step 1 `value.content` = `# Test Skill v2\n\nUpdated content.`
- [ ] Step 2 返回更新后的 content

## Failure Signals

- 返回 201 → 服务器区分了 create/update，违反幂等性
- 返回 409 → 服务器不允许覆盖已存在的 skill
