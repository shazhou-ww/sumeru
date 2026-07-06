---
scenario: Full-text search across session content with optional session filtering
feature: Full-Text Search
tags: [search, full-text, sessions]
---

# Full-Text Search

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | /search?q=\<query\>[&session=\<id\>] | Search session content |

### 响应信封

```json
{ "type": "@sumeru/search", "value": { "query": "...", "hits": [...] } }
```

### Hit 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| sessionId | string | Session containing the match |
| content | string | Matched content snippet |

---

## Given
- Host is running and healthy
- Session "sess-001" exists with messages containing "kubernetes deployment"
- Session "sess-002" exists with messages containing "docker compose"

## When — search across all sessions
```bash
curl -s "http://localhost:3000/search?q=kubernetes"
```

## Then — 200 search results
```json
{ "type": "@sumeru/search", "value": { "query": "kubernetes", "hits": [{ "sessionId": "sess-001", "content": "...kubernetes deployment..." }] } }
```

---

## When — search with session filter
```bash
curl -s "http://localhost:3000/search?q=docker&session=sess-002"
```

## Then — 200 filtered results
```json
{ "type": "@sumeru/search", "value": { "query": "docker", "hits": [{ "sessionId": "sess-002", "content": "...docker compose..." }] } }
```

---

## When — search with no results
```bash
curl -s "http://localhost:3000/search?q=nonexistent-term-xyz"
```

## Then — 200 empty hits
```json
{ "type": "@sumeru/search", "value": { "query": "nonexistent-term-xyz", "hits": [] } }
```

---

## When — search without query parameter
```bash
curl -s "http://localhost:3000/search"
```

## Then — 400 invalid_request
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "q parameter is required" } }
```

---

## When — search with empty query
```bash
curl -s "http://localhost:3000/search?q="
```

## Then — 400 invalid_request
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "q parameter must not be empty" } }
```

---

## When — search with empty session parameter
```bash
curl -s "http://localhost:3000/search?q=test&session="
```

## Then — 400 invalid_request
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "session parameter must not be empty" } }
```

---

## When — search with absent session parameter (no filter)
```bash
curl -s "http://localhost:3000/search?q=deployment"
```

## Then — 200 searches all sessions
```json
{ "type": "@sumeru/search", "value": { "query": "deployment", "hits": [{ "sessionId": "sess-001", "content": "...kubernetes deployment..." }] } }
```

---

## Notes
- `q` parameter is required and must be non-empty
- `session` parameter is optional — absent/null means search all sessions
- `session` parameter if present must not be empty string
- Results are returned as hit objects with sessionId and content snippet
- CLI: `sumeru search <query> [--session <id>]`
