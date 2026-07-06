---
scenario: In-session commands — model switch, reset, install-skill, snapshot, chat, exec
feature: Session Commands
tags: [session, commands, model, reset, snapshot, chat, exec]
---

# Session Commands

## API

| Method | Path | 说明 |
|--------|------|------|
| POST | /sessions/:id/commands | Dispatch command to running session |

### Command Types

| type | 说明 | Response |
|------|------|----------|
| model | Switch session model | 200 sync |
| reset | Clear context, optionally re-init persona | 202 async |
| install-skill | Write skill files into container | 200 sync |
| snapshot | Docker commit + register new prototype | 200 sync |
| chat | Submit message to session | 202 async |
| exec | Execute shell command in container | 200 sync |

### 响应信封

```json
{ "type": "@sumeru/command-result", "value": { "command": "model", "result": { ... } } }
```

---

## Given
- Host is running and healthy
- Session "sess-001" exists and is idle
- Model "anthropic:claude-3" exists in SQLite

## When — switch model
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"anthropic","model":"claude-3"}'
```

## Then — 200 model switched
```json
{ "type": "@sumeru/command-result", "value": { "command": "model", "result": { "provider": "anthropic", "model": "claude-3" } } }
```

---

## When — switch to nonexistent model
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"fake","model":"nonexistent"}'
```

## Then — 404 model_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "model_not_found", "message": "Model not found" } }
```

---

## When — switch model with invalid format
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"","model":""}'
```

## Then — 400 model_invalid_format
```json
{ "type": "@sumeru/error", "value": { "code": "model_invalid_format", "message": "Invalid model ID format. Expected format: provider:name" } }
```

---

## When — reset session
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"reset","persona":null}'
```

## Then — 202 accepted (async)
```json
{ "type": "@sumeru/command-result", "value": { "command": "reset", "status": "accepted" } }
```

---

## When — reset session with new persona
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"reset","persona":"analyst"}'
```

## Then — 202 accepted
```json
{ "type": "@sumeru/command-result", "value": { "command": "reset", "status": "accepted" } }
```

---

## When — install skill
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"install-skill","name":"web-scraper","content":null,"files":[{"path":"scraper.py","content":"import requests..."}]}'
```

## Then — 200 skill installed
```json
{ "type": "@sumeru/command-result", "value": { "command": "install-skill", "result": { "name": "web-scraper", "filesWritten": 1 } } }
```

---

## When — snapshot session
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"snapshot","name":"my-snapshot"}'
```

## Then — 200 snapshot created
```json
{ "type": "@sumeru/command-result", "value": { "command": "snapshot", "result": { "prototype": "my-snapshot" } } }
```

---

## When — chat message
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","content":"Hello, world!","messageId":null,"env":null,"model":null}'
```

## Then — 202 accepted (async)
```json
{ "type": "@sumeru/command-result", "value": { "command": "chat", "status": "accepted" } }
```

---

## When — chat while session is busy
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","content":"Another message","messageId":null,"env":null,"model":null}'
```

## Then — 409 session_busy
```json
{ "type": "@sumeru/error", "value": { "code": "session_busy", "message": "Session is already processing a request" } }
```

---

## When — exec command
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"exec","command":"ls -la /workspace"}'
```

## Then — 200 exec result
```json
{ "type": "@sumeru/command-result", "value": { "command": "exec", "result": { "output": "total 8\ndrwxr-xr-x ..." } } }
```

---

## When — command to nonexistent session
```bash
curl -s -X POST http://localhost:3000/sessions/nonexistent/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"model","provider":"anthropic","model":"claude-3"}'
```

## Then — 404 session_not_found
```json
{ "type": "@sumeru/error", "value": { "code": "session_not_found", "message": "Session not found" } }
```

---

## When — invalid JSON body
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d 'not json'
```

## Then — 400 invalid_json
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_json", "message": "Request body is not valid JSON" } }
```

---

## When — invalid command type
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"invalid"}'
```

## Then — 400 invalid_request
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "Invalid command type" } }
```

---

## When — adapter not ready
```bash
curl -s -X POST http://localhost:3000/sessions/sess-001/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","content":"hello","messageId":null,"env":null,"model":null}'
```

## Then — 503 adapter_unavailable
```json
{ "type": "@sumeru/error", "value": { "code": "adapter_unavailable", "message": "Adapter is not ready" } }
```

---

## Notes
- Commands are discriminated by the "type" field in the request body
- "model" and "exec" are synchronous (200), "reset" and "chat" are asynchronous (202)
- "install-skill" writes files directly into the running container
- "snapshot" performs docker commit and registers the result as a new prototype
- session_busy (409) only applies to "chat" commands when session is already processing
- CLI: `sumeru session model <id> <model-id>`, `sumeru reset <id>`, `sumeru snapshot <id>`
