---
scenario: "POST /instances/:id/reset clears session and re-initializes adapter"
feature: host-instances
tags: [host, docker, worker, reset, lifecycle, walkthrough, S7]
---

## Given
- Worker instance `$INST` has processed messages (outbox has events)

## When
```bash
# Reset the instance
curl -s -w "%{http_code}" -X POST "http://127.0.0.1:7901/instances/${INST}/reset"

# Send a message post-reset
curl -s -X POST "http://127.0.0.1:7901/instances/${INST}/inbox" \
  -H 'Content-Type: application/json' \
  -d '{"content":"What was my previous message?"}'

# Read outbox (no Last-Event-ID — reset clears sequence)
curl -sN --max-time 30 "http://127.0.0.1:7901/instances/${INST}/outbox"
```

## Then
- Reset: HTTP 204 (no content)
- Outbox event IDs restart from 1 (sequence reset)
- `event: turn` with `index: 0` (new session)
- Assistant does NOT recall previous messages ("This is the first message")
- `tokenUsage.input` matches first-message level (~1474, full system prompt re-injected)

## Notes
- Reset keeps the container running but clears adapter session state
- Container is NOT recreated — only the logical session resets
- Outbox consumers must reconnect without Last-Event-ID after a reset
