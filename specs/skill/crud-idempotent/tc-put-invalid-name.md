---
id: tc-put-invalid-name
spec: crud-idempotent
tags: [e2e, skill, crud, validation, error]
prerequisites:
  - Sumeru host running (port 7901)
---

# PUT Skill: Invalid Name

验证 PUT /skills/:name 中名称不合法时返回 400 + invalid_name 错误。

## Steps

1. 使用不合法名称创建 skill（以 `.` 开头）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/skills/.bad-name \
     -H 'Content-Type: text/plain' \
     -d 'some content'
   ```
   → 返回 400 + error 对象

## Expected

- [ ] Step 1 返回 HTTP 400
- [ ] Step 1 `type` = `@sumeru/error`
- [ ] Step 1 `value.error` = `invalid_name`
- [ ] Step 1 `value.message` 包含名称校验正则

## Failure Signals

- 返回 200 → 名称校验未生效，skill 不应该被创建
- 返回 404 → 路由匹配可能有问题，`.` 被路由解析器消费
