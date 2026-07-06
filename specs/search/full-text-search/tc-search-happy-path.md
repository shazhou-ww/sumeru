---
id: tc-search-happy-path
spec: full-text-search
tags: [e2e, search, full-text]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session "sess-001" exists with messages containing "kubernetes deployment"
  - Session "sess-002" exists with messages containing "docker compose"
---

# Full-Text Search: Happy Path

验证全文搜索功能，包含跨 session 搜索、session 过滤、空结果场景。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确认测试 session 数据存在：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/sess-001 | jq '.value.id'
   curl -s http://127.0.0.1:7901/sessions/sess-002 | jq '.value.id'
   ```

## Steps

1. 搜索跨所有 sessions（q=kubernetes）：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search?q=kubernetes"
   ```

2. 搜索并过滤特定 session（q=docker&session=sess-002）：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search?q=docker&session=sess-002"
   ```

3. 搜索不存在的关键词（应返回空 hits）：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search?q=nonexistent-term-xyz"
   ```

4. 搜索不带 session 过滤器（搜索所有 sessions）：
   ```bash
   curl -s -w '\n%{http_code}' "http://127.0.0.1:7901/search?q=deployment"
   ```

## Expected

- [ ] Step 1 返回 200，`type` = `@sumeru/search`
- [ ] Step 1 `value.query` = `kubernetes`
- [ ] Step 1 `value.hits` 非空，至少包含一个 hit
- [ ] Step 1 hits 中包含 `sessionId` = `sess-001`
- [ ] Step 1 每个 hit 包含 `sessionId` 和 `content` 字段
- [ ] Step 1 `content` snippet 包含匹配词 "kubernetes"
- [ ] Step 2 返回 200，`value.query` = `docker`
- [ ] Step 2 `value.hits` 仅包含 `sessionId` = `sess-002` 的结果
- [ ] Step 2 不包含 `sess-001` 的结果（session filter 生效）
- [ ] Step 3 返回 200，`value.hits` = `[]`（空数组，非 404）
- [ ] Step 3 `value.query` = `nonexistent-term-xyz`
- [ ] Step 4 返回 200，hits 中包含 `sess-001` 的 "deployment" 相关内容

## Failure Signals

- 搜索返回 500 → FTS 索引未正确初始化
- session 过滤无效（返回其他 session 结果） → WHERE 子句未添加 session 过滤
- 空结果返回 404 而非 200 空数组 → 错误地将无结果视为错误
- hits 缺少 sessionId 或 content → hit 对象序列化不完整
- content snippet 未包含搜索词 → FTS snippet 生成逻辑有误
