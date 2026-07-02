---
id: tc-list-and-detail
spec: adapter-list
tags: [e2e, adapter, read]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# List & Detail: Adapter Read Operations

验证 GET 端点能正确列出全部 adapter 以及获取单个详情，包含 404 路径。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

## Steps

1. 列出所有 adapter：
   ```bash
   curl -s http://127.0.0.1:7901/adapters | jq .
   ```

2. 获取单个详情：
   ```bash
   curl -s http://127.0.0.1:7901/adapters/cursor-agent | jq .
   ```

3. 获取不存在的 adapter：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/adapters/tc-ghost-adapter
   ```

## Expected

- [ ] Step 1 返回 200，`type` = `@sumeru/adapter-list`
- [ ] Step 1 列表中包含 `cursor-agent`、`claude-code`、`sarsapa` 等已知 adapter
- [ ] Step 1 每项含 `name`, `providerMode`, `credentialEnv`, `listModels`
- [ ] Step 2 返回 200，`type` = `@sumeru/adapter`
- [ ] Step 2 `value.name` = `cursor-agent`
- [ ] Step 3 返回 404，`error` = `adapter_not_found`

## Cleanup

无需清理（只读操作）。

## Failure Signals

- 列表为空 → adapter registry 未正确加载（检查 host 构建是否包含 adapter 包）
- 404 返回 `provider_not_found` 而非 `adapter_not_found` → 路由冲突或 handler 错误
- 响应缺少 `listModels` 字段 → manifest 类型未完整序列化
