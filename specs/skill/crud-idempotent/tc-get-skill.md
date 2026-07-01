---
id: tc-get-skill
spec: crud-idempotent
tags: [e2e, skill, crud, get, read]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Skill "test-skill" exists (from previous PUT)
---

# GET Skill: Read Existing

验证 GET /skills/:name 返回已创建的 skill 及正确内容。

## Setup

1. 确保 skill 已存在：
   ```bash
   curl -s -X PUT http://127.0.0.1:7901/skills/test-skill \
     -H 'Content-Type: application/json' \
     -d '{"content": "# Test Skill v2\n\nUpdated content."}'
   ```

## Steps

1. 读取 skill：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/skills/test-skill
   ```
   → 返回 200 + skill 对象

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 1 `type` = `@sumeru/skill`
- [ ] Step 1 `value.name` = `test-skill`
- [ ] Step 1 `value.content` 包含 `# Test Skill v2`

## Failure Signals

- 返回 404 → skill 未被持久化，PUT 操作可能未正确写入磁盘
- 返回 500 → 读取文件出错，检查文件系统权限
