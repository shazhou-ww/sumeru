---
id: tc-persona-error-paths
spec: crud-lifecycle
tags: [e2e, persona, error, validation]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Persona Error Paths

验证 Persona API 的各种错误路径。

## Setup

1. 创建用于冲突测试和删除保护测试的数据：
   ```bash
   # Provider + Model（用于 prototype 引用测试）
   curl -s -X POST http://127.0.0.1:7901/providers/tc-provider \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://api.anthropic.com"}'

   curl -s -X POST http://127.0.0.1:7901/models/tc-model \
     -H 'Content-Type: application/json' \
     -d '{"provider":"tc-provider","model":"claude-sonnet-4-20250514"}'

   # Persona（冲突目标）
   curl -s -X POST http://127.0.0.1:7901/personas/tc-conflict \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"Conflict test persona.","skills":[]}'

   # Prototype 引用该 Persona（删除保护测试）
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-dep-proto \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-dep-proto","persona":"tc-conflict","model":"tc-model","image":"sumeru-worker:latest"}'
   ```

## Steps

1. 重复创建（409）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/personas/tc-conflict \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"Another.","skills":[]}'
   ```

2. 引用不存在的 skill（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/personas/tc-bad-skill \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"Bad skill ref.","skills":["ghost-skill"]}'
   ```

3. 缺少 instructions 字段（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/personas/tc-no-inst \
     -H 'Content-Type: application/json' \
     -d '{"skills":[]}'
   ```

4. GET 不存在的 persona（404）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/personas/tc-ghost
   ```

5. PUT 不存在的 persona（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/personas/tc-ghost \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"Updated.","skills":[]}'
   ```

6. DELETE 被 prototype 引用的 persona（409 persona_in_use）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/personas/tc-conflict
   ```

7. DELETE 不存在的 persona（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/personas/tc-ghost
   ```

## Expected

- [ ] Step 1 返回 409，`error` = `persona_exists`
- [ ] Step 2 返回 400，`error` = `skills_not_found`，message 含 `ghost-skill`
- [ ] Step 3 返回 400，`error` = `invalid_body`，message 含 `instructions`
- [ ] Step 4 返回 404，`error` = `persona_not_found`
- [ ] Step 5 返回 404，`error` = `persona_not_found`
- [ ] Step 6 返回 409，`error` = `persona_in_use`，message 含 `tc-dep-proto`
- [ ] Step 7 返回 404，`error` = `persona_not_found`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-dep-proto
curl -s -X DELETE http://127.0.0.1:7901/personas/tc-conflict
curl -s -X DELETE http://127.0.0.1:7901/models/tc-model
curl -s -X DELETE http://127.0.0.1:7901/providers/tc-provider
```

## Failure Signals

- Step 2 返回 201 → skill 引用校验未实现
- Step 6 返回 204 → 删除保护未实现，Prototype 将引用已删除的 Persona
