---
scenario: "Second message reuses warm adapter session (no re-init)"
feature: host-instances
tags: [host, docker, worker, warm, session, walkthrough, S7]
---

## Given
- Worker instance `$INST` has already processed one message successfully
- Outbox has events id: 1 (turn) and id: 2 (done) from first message

## When
```bash
# Send second message
curl -s -X POST "http://127.0.0.1:7901/instances/${INST}/inbox" \
  -H 'Content-Type: application/json' \
  -d '{"content":"What was my previous message?"}'

# Read new events only (resume after event 2)
curl -sN --max-time 30 \
  -H "Last-Event-ID: 2" \
  "http://127.0.0.1:7901/instances/${INST}/outbox"
```

## Then
- Inbox: HTTP 202
- Outbox resumes from id: 3 (not replaying 1–2)
- `event: turn` with `index: 1` (proves same session, not re-init which would reset to 0)
- Assistant recalls the previous message content (proves session continuity)
- `tokenUsage.input` is lower than first message (no system prompt re-injection)

## Notes
- Last-Event-ID header enables SSE resume semantics
- No re-init proves the adapter stays warm between messages in same session
- Token count difference: first message ~1474 input (full init), second ~426 (incremental)
