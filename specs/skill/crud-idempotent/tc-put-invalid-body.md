---
id: tc-put-invalid-body
spec: crud-idempotent
tags: [e2e, skill, crud, validation, error]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# PUT Skill: Invalid Body (JSON missing content field)

验证 PUT /skills/:name 以 JSON body 但缺少 content 字段时返回 400 + invalid_body 错误。

## Steps

1. 使用缺少 content 字段的 JSON body：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/skills/x \
     -H 'Content-Type: application/json' \
     -d '{"text": "wrong field"}'
   ```
   → 返回 400 + error 对象

## Expected

- [ ] Step 1 返回 HTTP 400
- [ ] Step 1 `type` = `@sumeru/error`
- [ ] Step 1 `value.error` = `invalid_body`
- [ ] Step 1 `value.message` 包含 body 格式说明

## Failure Signals

- 返回 200 → body 校验未生效，skill 不应该被创建
- 返回 500 → 服务器未正确处理无效 JSON 结构
