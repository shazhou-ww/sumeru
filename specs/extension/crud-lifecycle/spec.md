---
scenario: Extension CRUD lifecycle — create, read, update, delete JSON-file-based extensions
feature: Extension Management
tags: [extension, crud, json, dockerfile]
---

# Extension CRUD Lifecycle

## Extension 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✓ | From URL path, unique identifier |
| description | string | ✗ | Defaults to "" |
| dockerfile | string | ✓ (create) | Required on create, must be non-empty; optional on update |
| createdAt | ISO string | auto | Set on creation |
| updatedAt | ISO string | auto | Updated on every write |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /extensions | List all extensions |
| GET | /extensions/:name | Get single extension |
| PUT | /extensions/:name | Create or update |
| DELETE | /extensions/:name | Remove extension |

### 响应信封

```json
{ "type": "@sumeru/extension-list", "value": [...] }
{ "type": "@sumeru/extension", "value": { "name": "...", "description": "...", "dockerfile": "...", "createdAt": "...", "updatedAt": "..." } }
```

---

## Given
- Host is running and healthy
- No extensions exist

## When — list extensions (empty)
```bash
curl -s http://localhost:3000/extensions
```

## Then — 200 empty list
```json
{ "type": "@sumeru/extension-list", "value": [] }
```

---

## When — create extension via PUT
```bash
curl -s -X PUT http://localhost:3000/extensions/mcp-filesystem \
  -H "Content-Type: application/json" \
  -d '{"description":"MCP filesystem server","dockerfile":"FROM node:20\nRUN npm i @mcp/filesystem"}'
```

## Then — 201 created
```json
{ "type": "@sumeru/extension", "value": { "name": "mcp-filesystem", "description": "MCP filesystem server", "dockerfile": "FROM node:20\nRUN npm i @mcp/filesystem", "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z" } }
```

---

## When — get extension
```bash
curl -s http://localhost:3000/extensions/mcp-filesystem
```

## Then — 200 extension detail
```json
{ "type": "@sumeru/extension", "value": { "name": "mcp-filesystem", "description": "MCP filesystem server", "dockerfile": "FROM node:20\nRUN npm i @mcp/filesystem", "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z" } }
```

---

## When — update extension (partial)
```bash
curl -s -X PUT http://localhost:3000/extensions/mcp-filesystem \
  -H "Content-Type: application/json" \
  -d '{"description":"Updated MCP filesystem"}'
```

## Then — 200 updated (omitted fields preserved)
```json
{ "type": "@sumeru/extension", "value": { "name": "mcp-filesystem", "description": "Updated MCP filesystem", "dockerfile": "FROM node:20\nRUN npm i @mcp/filesystem", "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:01:00.000Z" } }
```

---

## When — delete extension
```bash
curl -s -X DELETE http://localhost:3000/extensions/mcp-filesystem
```

## Then — 204 No Content

---

## When — get deleted extension
```bash
curl -s http://localhost:3000/extensions/mcp-filesystem
```

## Then — 404
```json
{ "type": "@sumeru/error", "value": { "code": "extension_not_found", "message": "Extension not found" } }
```

---

## When — delete nonexistent extension
```bash
curl -s -X DELETE http://localhost:3000/extensions/nonexistent
```

## Then — 404
```json
{ "type": "@sumeru/error", "value": { "code": "extension_not_found", "message": "Extension not found" } }
```

---

## When — create without dockerfile
```bash
curl -s -X PUT http://localhost:3000/extensions/bad-ext \
  -H "Content-Type: application/json" \
  -d '{"description":"Missing dockerfile"}'
```

## Then — 400 invalid_body
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_body", "message": "dockerfile is required on create" } }
```

---

## When — update with empty dockerfile
```bash
curl -s -X PUT http://localhost:3000/extensions/mcp-filesystem \
  -H "Content-Type: application/json" \
  -d '{"dockerfile":""}'
```

## Then — 400 invalid_body
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_body", "message": "dockerfile must be non-empty" } }
```

---

## When — create with default description
```bash
curl -s -X PUT http://localhost:3000/extensions/minimal \
  -H "Content-Type: application/json" \
  -d '{"dockerfile":"FROM alpine"}'
```

## Then — 201 created with empty description
```json
{ "type": "@sumeru/extension", "value": { "name": "minimal", "description": "", "dockerfile": "FROM alpine", "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z" } }
```

---

## Notes
- Extensions are stored as JSON files on disk (not SQLite)
- PUT is upsert: 201 for new, 200 for existing
- On update, omitted fields keep their existing values
- dockerfile must be non-empty when provided (create or update)
- Body must be JSON (no YAML support unlike prototypes)
- CLI: `sumeru extension list/get/put/remove`
