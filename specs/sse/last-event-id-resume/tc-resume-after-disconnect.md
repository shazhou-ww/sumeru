---
title: "TC: Resume After Disconnect with Last-Event-ID"
spec: ./spec.md
scenarios: [1, 2]
status: verified
---

# TC: Resume After Disconnect with Last-Event-ID

## Objective

Verify that reconnecting to SSE with `Last-Event-ID: N` replays only events with id > N.

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- A session that has completed with multiple events in the buffer

## Steps

1. Create a session with a task that generates multiple turns:
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"test","task":"Write a haiku about mountains, then write another about rivers"}'
   ```

2. Wait for session to reach `idle` status (poll GET /sessions/:id).

3. Connect to SSE **without** Last-Event-ID to confirm total event count:
   ```bash
   curl -s --max-time 5 -H 'Accept: text/event-stream' \
     http://127.0.0.1:7901/sessions/:id/events
   ```
   **Expected**: Events with id starting from 1 up to the exit event.

4. Reconnect with `Last-Event-ID: 1`:
   ```bash
   curl -s --max-time 5 -H 'Accept: text/event-stream' \
     -H 'Last-Event-ID: 1' \
     http://127.0.0.1:7901/sessions/:id/events
   ```

## Assertions

- **A1**: Response with `Last-Event-ID: 1` contains ONLY events with id > 1
- **A2**: The first event id in the resumed stream is 2 (or next valid after 1)
- **A3**: All events replayed maintain proper SSE format (`id:`, `event:`, `data:`)
- **A4**: If the last replayed event is `exit`, the connection closes after delivery

## Verification Result

**PASS** — Verified 2026-06-30

Session `ses_01KWBVB5ETAB3ZW08320BTYD0G`:
- Full stream (no header): returned events id 1 (turn) and id 2 (exit)
- With `Last-Event-ID: 1`: returned only id 2 (exit event)
- Connection closed after exit event was delivered

All assertions confirmed.
