---
scenario: "Resume idle session with POST /sessions/:id/messages"
feature: session-resume
tags: [host, session, resume, concurrency, v3]
---

## Given
- Session `$SID` exists and has status `idle` (previous turn completed or suspended)
- Host concurrency has available slots (`running < maxRunning`)
- Container is still alive (`containerId` is non-null)

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"继续之前的任务，检查测试是否通过"}'
```

## Then
- HTTP 202 with envelope `{"ok":true, "data":{"sessionId":"$SID","messageId":"msg_..."}}`
- Session status transitions: `idle` → `running`
- Session occupies a concurrency slot (`countRunning()` increments by 1)
- Adapter receives inbox message via stdin: `{"type":"message","value":{"messageId":"...","content":"...","project":"..."}}`
- SSE stream emits subsequent `turn` events from adapter output
- When adapter emits `done`/`suspend`/`error`, session returns to `idle` and slot is released

## Given (conflict case)
- Session `$SID` exists and has status `running` (adapter is actively processing)

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"another message while busy"}'
```

## Then
- HTTP 409 with error envelope `{"ok":false,"error":{"code":"session_busy","message":"Session is already running"}}`
- Session state is unchanged
- No message is delivered to the adapter

## Given (not found case)
- No session exists with id `$SID`

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/nonexistent/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hello"}'
```

## Then
- HTTP 404 with error envelope `{"ok":false,"error":{"code":"session_not_found","message":"Session not found"}}`

## Notes
- `submitMessage` in session-manager.ts guards: not_found → 404, running → 409, no container → 503
- Resume flow calls `waitForRunningSlot()` — if concurrency is full, request blocks until a slot opens
- `exit` field is reset to `null` on resume (previous exit signal cleared)
- User turn is recorded to OCAS history before adapter processes it
