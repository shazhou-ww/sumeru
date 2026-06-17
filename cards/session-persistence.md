---
id: session-persistence
title: "Session Persistence and Rehydration"
sources:
  - README.md
  - packages/server/src/session/store.ts
  - packages/server/src/ocas/store.ts
tags: [architecture, persistence, ocas, session-management]
created: 2026-06-17
updated: 2026-06-17
---

# Session Persistence and Rehydration

Sumeru 的 session 采用 **持久化历史 + 运行时状态分离** 的设计：所有 Turn 内容、session 元数据、以及每个 session 的 **有序 Turn 列表指针** 都落盘到 ocas store，server 重启后自动 rehydrate，历史完全可读但不可继续发新消息。

## Persistence Layer

### What Gets Persisted

所有持久化数据存储在 `<ocasDir>/_store.db`（SQLite 数据库，与 FTS5 搜索索引同库）：

1. **Turn 内容** — 每个 Turn 存储为一个 `@sumeru/turn` ocas 节点
   - 节点包含：`index`, `role`, `content`, `timestamp`, `toolCalls`, `tokens`
   - 节点通过 CAS 哈希寻址，不可变

2. **Session 元数据** — 每个 Session 创建时写入一个 `@sumeru/session-meta` 节点
   - 节点包含：`id`, `gateway`, `adapter`, `createdAt`, `config`, `resolvedCwd`
   - `metaHash` 记录在 SQLite 的 `sumeru_session_index` 表中

3. **有序 Turn 列表指针** — SQLite 表 `sumeru_session_turns`
   - 每行记录：`(session_id, turn_index, turn_hash)`
   - `turn_index` 是 0-based 追加位置
   - 保证 Turn 顺序与写入顺序完全一致

### SQLite Schema

```sql
-- Session index (created_at ASC for chronological listing)
CREATE TABLE sumeru_session_index (
  session_id TEXT PRIMARY KEY,
  gateway TEXT NOT NULL,
  adapter TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'idle' | 'active' | 'closed'
  meta_hash TEXT
);

-- Turn list pointers (ordered by turn_index)
CREATE TABLE sumeru_session_turns (
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  turn_hash TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_index)
);
```

### Write Path

#### Session Creation

1. 生成 `ses_` + ULID 作为 session ID
2. **先** 写入 `@sumeru/session-meta` 节点到 ocas，获取 `metaHash`
   - 如果 ocas 写入失败，in-memory session 不创建，返回 500
3. 写入 SQLite 的 `sumeru_session_index` 表（best-effort）
4. 创建 in-memory `Session` 对象，初始状态为 `idle`
5. 如果 adapter 返回了 `NativeSessionRef`，记录在内存 Map 中（**不落盘**）

#### Turn Append

1. Adapter 返回新的 Turn 列表
2. 每个 Turn 写入 `@sumeru/turn` 节点到 ocas，获取 `turnHash`
3. **先** 写入 SQLite 的 `sumeru_session_turns` 表：`(sessionId, turnIndex, turnHash)`
   - `turnIndex` 是当前 `turnHashes.length`（追加前的长度）
   - 写入是幂等的（`PRIMARY KEY (session_id, turn_index)`）
   - 如果 SQLite 写入失败，整个 send 操作失败（不会静默分叉内存与磁盘）
4. **后** 追加 `turnHash` 到 in-memory `session.turnHashes`

这样保证 **磁盘永远不会落后于内存**。

#### Session Close

1. In-memory 状态更新为 `closed`
2. Best-effort 更新 SQLite 的 `sumeru_session_index.status = 'closed'`
   - 失败只记录警告，in-memory 状态是 wire 真相

## Rehydration on Restart

### What Gets Rehydrated

`createSessionStore` 在创建 store 时自动调用 `rehydrate()`，从磁盘恢复：

1. **Session 列表** — 从 `sumeru_session_index` 读取所有行（按 `created_at ASC` 排序）
2. **Turn 列表指针** — 从 `sumeru_session_turns` 批量读取所有 session 的 Turn 哈希
3. **Config 恢复** — 从 `metaHash` 指向的 `@sumeru/session-meta` 节点读取 `config` 字段
   - 如果 `metaHash` 为 `null` 或节点丢失，fallback 到 `config: {}`，记录警告
   - Turn 历史是优先级，config 是次要的

### What Does NOT Get Rehydrated

**`NativeSessionRef` 不落盘** — adapter 侧的运行时状态（如 Hermes 的 session 目录、Claude Code 的 subprocess）无法恢复。

### Rehydrated Session Behavior

| 操作 | 行为 |
|------|------|
| `GET /gateways/:name/sessions` | ✅ 列出 rehydrated sessions |
| `GET /gateways/:name/sessions/:id` | ✅ 返回 session 详情 |
| `GET .../messages` | ✅ 返回完整 Turn 历史（相同 total、相同 hash、相同顺序） |
| `POST .../messages` | ❌ 返回 `503 adapter_unavailable`（`NativeSessionRef` 丢失） |
| `DELETE .../sessions/:id` | ✅ 可关闭（即使 `NativeSessionRef` 丢失，`adapter.close()` 跳过） |

### Status Recovery

| 重启前状态 | 重启后状态 | 说明 |
|-----------|-----------|------|
| `idle` | `idle` | 等待发送 |
| `active` | `idle` | 重启不可能让一次发送悬在半途 |
| `closed` | `closed` | 已关闭的 session 保持关闭 |

### Console Output

```
[sumeru] rehydrated 12 sessions, 347 turns
[sumeru] search index ready: 347 turns indexed
```

## Ocas Store Structure

### openSumeruOcas()

Server 启动时调用 `openSumeruOcas(dir)` 初始化 ocas store：

1. 创建 `dir` 目录（如果不存在）
2. 打开 `@ocas/fs` CAS store（内容寻址存储）
3. 打开 SQLite var/tag store（`<dir>/_store.db`）
4. Bootstrap `@ocas/core` schemas（schema-of-schemas）
5. 注册 Sumeru schemas：
   - `@sumeru/turn` — Turn 内容节点
   - `@sumeru/session-meta` — Session 元数据节点
6. 创建 FTS5 搜索索引（同一 SQLite 数据库）
7. 返回 `SumeruOcas` 对象：`{ store, turnSchemaHash, sessionMetaSchemaHash, metaSchemaHash, schemaAliases, searchIndex }`

### Validation Before Write

所有写入 ocas 的 Sumeru 数据都经过 schema 验证：

```typescript
function recordPayload(store: Store, schemaHash: Hash, payload: unknown): Hash {
  validatePayload(store, schemaHash, payload);  // Ajv validation
  return store.cas.put(schemaHash, payload);     // Write to CAS
}
```

- `@ocas/core` 的 `Store.cas.put` 本身 **不验证** schema
- Sumeru 的 recording paths 总是通过 `recordPayload` 确保 schema 合法再落盘
- 验证使用独立的 Ajv 实例，注册了 `date-time` format（不依赖 `ajv-formats`）

## Read Path

### GET /gateways/:name/sessions/:id/messages

1. 从 in-memory `session.turnHashes` 获取哈希列表
2. 根据 `offset` / `limit` 切片
3. 对每个 hash 调用 `ocas.store.cas.get(hash)` 读取 `@sumeru/turn` 节点
4. 将 `hash` 注入到每个 Turn 的 `hash` 字段（adapter 返回时为 `null`）
5. 返回 `@sumeru/message-history` envelope

### GET /ocas/:hash

直接读取 ocas 节点，支持 ETag / 304 缓存：

```bash
curl http://127.0.0.1:7900/ocas/01234567890AB
# → {"type":"@sumeru/turn","value":{...}}
```

- `Cache-Control: public, max-age=31536000, immutable` — CAS 节点永不变
- `ETag: "01234567890AB"` — hash 即 ETag

## Design Principles

1. **历史不可变** — Turn 内容通过 CAS 存储，hash 即身份，永不修改
2. **状态分离** — 持久化状态（历史）与运行时状态（`NativeSessionRef`）解耦
3. **磁盘先行** — Turn 列表指针 **先写 SQLite，后更新内存**，保证磁盘不落后
4. **优雅降级** — Config 恢复失败 fallback 到 `{}`，Turn 历史是优先级
5. **幂等写入** — SQLite 的 `PRIMARY KEY (session_id, turn_index)` 保证重复写入无副作用
6. **可审计** — 所有交互通过 ocas 全量记录，`GET /ocas/:hash` 可直接读取任意历史节点

## Failure Modes

| 场景 | 行为 |
|------|------|
| Ocas 写入失败（session meta） | Session 创建失败，返回 500，in-memory 不创建 |
| SQLite 写入失败（turn pointer） | Send 操作失败，SSE 返回 error 事件 |
| SQLite 写入失败（session index seed） | 记录警告，继续（搜索索引可从 ocas 重建） |
| Rehydrate 读取失败 | 记录警告，跳过 rehydration，server 继续启动 |
| Meta 节点丢失（rehydrate） | Config fallback 到 `{}`，记录警告，Turn 历史正常恢复 |
| Turn 节点丢失（rehydrate） | 该 Turn 跳过（`node === null` continue），其他 Turn 正常 |
