---
id: event-log-persistence
area: session
---
# Event Log Persistence (JSONL)

SSE events are persisted to JSONL files at `<rootDir>/data/logs/<session-id>.jsonl`.

## Behavior
- Each SSE event (turn, exit) is appended as a JSON line on emit
- Format: {"event": "<type>", "data": "<json-string>", "timestamp": "<iso>"}
- GET /sessions/:id/events falls back to JSONL when SSE buffer is empty (e.g. after host restart)
- session delete removes the log file
- Files can be manually deleted for disk cleanup

## Guarantees
- Events survive host restart
- Order preserved (append-only)
- No data loss between buffer and disk (sync write)
