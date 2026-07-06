---
id: tc-prototype-error-paths
spec: crud-lifecycle
tags: [e2e, prototype, error, validation]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - SQLite contains Persona "coder" and Model "openai:gpt-4"
  - Adapter registry contains adapter "docker" (providerMode !== "builtin-only")
  - No persona named "nonexistent" exists
  - No adapter named "nonexistent" exists
  - No model matching "invalid-format" exists
---

# Prototype CRUD: Error Paths

验证 Prototype 各类错误场景返回正确的 HTTP 状态码与错误码。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/bad-agent
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-nonexistent
   ```

## Steps

### 404 — Prototype Not Found

1. GET 不存在的 Prototype：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes/tc-nonexistent
   ```

### 400 — persona_not_found

2. 创建时引用不存在的 Persona：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/bad-agent \
     -H 'Content-Type: application/json' \
     -d '{"persona":"nonexistent","model":"openai:gpt-4","adapter":"docker"}'
   ```

### 400 — adapter_not_found

3. 创建时引用不存在的 Adapter：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/bad-agent \
     -H 'Content-Type: application/json' \
     -d '{"persona":"coder","model":"openai:gpt-4","adapter":"nonexistent"}'
   ```

### 400 — model_not_found

4. 创建时使用无效的 model 格式：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/bad-agent \
     -H 'Content-Type: application/json' \
     -d '{"persona":"coder","model":"invalid-format","adapter":"docker"}'
   ```

### 400 — model_required

5. 创建时 model 为 null 但 adapter 非 builtin-only：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/bad-agent \
     -H 'Content-Type: application/json' \
     -d '{"persona":"coder","model":null,"adapter":"docker"}'
   ```

## Expected

- [ ] Step 1 返回 404，`type` = `@sumeru/error`，`value.code` = `prototype_not_found`
- [ ] Step 1 `value.message` = `Prototype not found`
- [ ] Step 2 返回 400，`type` = `@sumeru/error`，`value.code` = `persona_not_found`
- [ ] Step 2 `value.message` = `Persona not found`
- [ ] Step 3 返回 400，`type` = `@sumeru/error`，`value.code` = `adapter_not_found`
- [ ] Step 3 `value.message` = `Adapter not found`
- [ ] Step 4 返回 400，`type` = `@sumeru/error`，`value.code` = `model_not_found`
- [ ] Step 4 `value.message` = `Model not found`
- [ ] Step 5 返回 400，`type` = `@sumeru/error`，`value.code` = `model_required`
- [ ] Step 5 `value.message` = `Model is required for this adapter`
- [ ] Steps 2–5 均未在磁盘创建 YAML 文件（验证 rollback）

## Failure Signals

- 404 返回 200 空对象 → 路由缺少 not-found 处理
- 400 错误但 code 字段缺失 → 错误信封格式不符
- persona_not_found 返回 500 → validation 抛出未捕获异常
- model_required 未触发 → adapter providerMode 判断逻辑有误
- 失败请求后磁盘存在 YAML 文件 → rollback 逻辑未执行
