---
scenario: "Inbox message produces turn + done SSE events on outbox"
feature: host-instances
tags: [host, docker, worker, sse, roundtrip, walkthrough, S7]
---

## Given
- A running worker instance `$INST` (created via POST /instances)
- Adapter inside container is initialized and ready

## When
```bash
# 1. Send message
curl -s -X POST "http://127.0.0.1:7901/instances/${INST}/inbox" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Say exactly: hello from docker"}'

# 2. Read outbox SSE stream
curl -sN --max-time 30 "http://127.0.0.1:7901/instances/${INST}/outbox"
```

## Then
- Inbox: HTTP 202, `{"type":"@sumeru/inbox-accepted","value":{"instanceId":"...","messageId":"..."}}`
- Outbox SSE stream contains exactly 2 events:
  1. `event: turn` — `data.value.role` = "assistant", `data.value.content` non-empty, `data.value.index` = 0
  2. `event: done` — `data.value.tokenUsage` has `input` and `output` counts
- Each event has sequential `id:` field (1, 2)
- Content matches instruction ("hello from docker")

## Notes
- The full pipeline: inbox POST → dispatch → docker exec adapter → stdin NDJSON → adapter processes → stdout turns → Host SSE broadcast
- tokenUsage proves the adapter properly reports usage back to Host
