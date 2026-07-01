---
id: tc-put-plain-text
spec: crud-idempotent
tags: [e2e, skill, crud, create, plain-text]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Skill "plain-skill" does NOT exist (clean state)
---

# PUT Create Skill: Plain Text Body

验证 PUT /skills/:name 以 text/plain Content-Type 创建 skill，整个 body 作为 content。

## Setup

1. 确保目标 skill 不存在（清理残留）：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/skills/plain-skill
   ```

## Steps

1. 用 plain text 创建 skill：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/skills/plain-skill \
     -H 'Content-Type: text/plain' \
     -d '# Plain Skill

This skill was created with plain text content type.'
   ```
   → 返回 200 + skill 对象

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 1 `type` = `@sumeru/skill`
- [ ] Step 1 `value.name` = `plain-skill`
- [ ] Step 1 `value.content` 包含 `# Plain Skill`

## Failure Signals

- 返回 400 → 服务器可能不支持 text/plain Content-Type
- 返回 415 → 服务器不识别 Content-Type，需检查请求处理逻辑
