---
id: tc-list-and-detail
spec: crud-lifecycle
tags: [e2e, prototype, read]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Persona "tc-persona" and Model "tc-model" exist in SQLite
---

# List & Detail: Read Operations

验证 GET 端点能正确列出全部 prototype 以及获取单个详情，包含 404 路径。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确保测试 prototype 存在：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-read-alpha \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-read-alpha",
       "persona": "tc-persona",
       "model": "tc-model",
       "image": "sumeru-worker:latest",
       "defaults": null
     }'
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-read-beta \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-read-beta",
       "persona": "tc-persona",
       "model": "tc-model",
       "image": "sumeru-worker:latest",
       "defaults": { "maxTurns": 10, "timeout": 120, "resources": { "cpu": 1, "memory": "1Gi" } }
     }'
   ```

## Steps

1. 列出所有 prototype：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes | jq .
   ```

2. 获取单个详情：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/tc-read-alpha | jq .
   ```

3. 获取不存在的 prototype：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes/tc-ghost-read
   ```

## Expected

- [ ] Step 1 返回 200，`type` = `@sumeru/prototype-list`
- [ ] Step 1 列表中包含 `tc-read-alpha` 和 `tc-read-beta`
- [ ] Step 1 每项含 `name`, `prototype`, `yamlPath`, `prototypeHash`, `composePath`
- [ ] Step 2 返回 200，`type` = `@sumeru/prototype`
- [ ] Step 2 `value.prototype.persona` = `tc-persona`
- [ ] Step 2 `value.prototype.model` = `tc-model`
- [ ] Step 3 返回 404，`error` = `prototype_not_found`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-read-alpha
curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-read-beta
```

## Failure Signals

- 列表为空 → Setup 创建失败（检查 persona/model 是否存在）
- 响应中 prototype 对象含 `instructions` / `skills` → 使用的是旧格式，代码未更新
