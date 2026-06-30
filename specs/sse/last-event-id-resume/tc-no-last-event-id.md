---
title: "TC: No Last-Event-ID Header — Replay From Start"
spec: ./spec.md
scenarios: [4]
status: verified
---

# TC: No Last-Event-ID Header — Replay From Start

## Objective

Verify that connecting to SSE without a `Last-Event-ID` header replays all buffered events from the beginning (id 1).

## Preconditions

- Sumeru host running on port 7901
- A completed session with events in the buffer

## Steps

1. Create a session and wait for it to complete:
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"test","task":"Write a haiku"}'
   ```

2. Connect to the SSE endpoint without any `Last-Event-ID` header:
   ```bash
   curl -s --max-time 5 -H 'Accept: text/event-stream' \
     http://127.0.0.1:7901/sessions/:id/events
   ```

## Assertions

- **A1**: The first event in the stream has `id: 1`
- **A2**: All buffered events are delivered in order (id 1, 2, 3, ...)
- **A3**: Events include both `turn` and `exit` event types
- **A4**: The stream includes the complete history of the session from its start

## Verification Result

**PASS** — Verified 2026-06-30

Session `ses_01KWBVB5ETAB3ZW08320BTYD0G`:
- Connected without Last-Event-ID header
- Received: id 1 (event: turn), id 2 (event: exit)
- First event id is 1, confirming replay from start
- Exit event delivered and connection closed

All assertions confirmed.
