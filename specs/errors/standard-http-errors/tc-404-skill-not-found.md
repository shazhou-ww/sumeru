---
id: tc-404-skill-not-found
spec: standard-http-errors
tags: [e2e, errors, 404, skill]
prerequisites:
  - Sumeru host running (port 7901)
  - No skill named "ghost-skill" exists
---

# 404 Skill Not Found

验证请求不存在的 skill 时返回 404 skill_not_found 错误。

## Setup

无额外 setup。确认不存在名为 ghost-skill 的 skill。

## Steps

1. GET 不存在的 skill：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/skills/ghost-skill
   ```
   → 应返回 404

2. 验证错误结构：
   ```bash
   curl -s http://127.0.0.1:7901/skills/ghost-skill | jq '.type'
   ```
   → 应返回 `"@sumeru/error"`

3. 验证错误码：
   ```bash
   curl -s http://127.0.0.1:7901/skills/ghost-skill | jq '.value.error'
   ```
   → 应返回 `"skill_not_found"`

4. 验证消息包含 skill 名称：
   ```bash
   curl -s http://127.0.0.1:7901/skills/ghost-skill | jq '.value.message'
   ```
   → 应包含 "ghost-skill"

## Expected

- [ ] HTTP 状态码为 404
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"skill_not_found"`
- [ ] `.value.message` 包含 "ghost-skill"

## Failure Signals

- 返回 200 → skill 路由返回空对象或默认值
- 返回 500 → skill 文件读取错误未被正确处理
