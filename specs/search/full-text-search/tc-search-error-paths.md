---
id: tc-search-error-paths
spec: full-text-search
tags: [e2e, search, error, validation]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Full-Text Search: Error Paths

验证搜索接口参数验证错误返回正确的 HTTP 400 与错误码。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

## Steps

### 400 — Missing q parameter

1. 搜索不带 q 参数：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search"
   ```

### 400 — Empty q parameter

2. 搜索 q 参数为空字符串：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search?q="
   ```

### 400 — Empty session filter

3. 搜索 session 参数为空字符串：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search?q=test&session="
   ```

## Expected

- [ ] Step 1 返回 400，`type` = `@sumeru/error`
- [ ] Step 1 `value.code` = `invalid_request`
- [ ] Step 1 `value.message` = `q parameter is required`
- [ ] Step 2 返回 400，`type` = `@sumeru/error`
- [ ] Step 2 `value.code` = `invalid_request`
- [ ] Step 2 `value.message` = `q parameter must not be empty`
- [ ] Step 3 返回 400，`type` = `@sumeru/error`
- [ ] Step 3 `value.code` = `invalid_request`
- [ ] Step 3 `value.message` = `Query parameter session must be a non-empty string when provided`

## Failure Signals

- Missing q 返回 200 空结果 → 参数校验被跳过，直接执行了空搜索
- Empty q 返回 200 → 未区分缺失与空字符串的校验
- Empty session 未被捕获 → session 参数校验不完整
- 返回 500 而非 400 → 校验逻辑抛出未捕获异常
- 错误 code 不是 `invalid_request` → 错误码枚举不一致
