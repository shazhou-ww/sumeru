---
title: "TC: Invalid Last-Event-ID — Treated as No Header"
spec: ./spec.md
scenarios: [5]
status: verified
---

# TC: Invalid Last-Event-ID — Treated as No Header

## Objective

Verify that invalid (non-integer or negative) `Last-Event-ID` values are treated as if no header was sent, resulting in a full replay from the start.

## Preconditions

- Sumeru host running on port 7901
- A completed session with events in the buffer

## Steps

1. Connect with `Last-Event-ID: abc` (non-numeric):
   ```bash
   curl -s --max-time 5 -H 'Accept: text/event-stream' \
     -H 'Last-Event-ID: abc' \
     http://127.0.0.1:7901/sessions/:id/events
   ```

2. Connect with `Last-Event-ID: -1` (negative number):
   ```bash
   curl -s --max-time 5 -H 'Accept: text/event-stream' \
     -H 'Last-Event-ID: -1' \
     http://127.0.0.1:7901/sessions/:id/events
   ```

3. Connect with `Last-Event-ID: 3.14` (float):
   ```bash
   curl -s --max-time 5 -H 'Accept: text/event-stream' \
     -H 'Last-Event-ID: 3.14' \
     http://127.0.0.1:7901/sessions/:id/events
   ```

## Assertions

- **A1**: `Last-Event-ID: abc` results in full replay from id 1
- **A2**: `Last-Event-ID: -1` results in full replay from id 1
- **A3**: `Last-Event-ID: 3.14` results in full replay from id 1 (non-integer)
- **A4**: No error response; stream opens normally with all events
- **A5**: Behavior is identical to connecting without any Last-Event-ID header

## Verification Result

**PASS** — Verified 2026-06-30

Session `ses_01KWBVB5ETAB3ZW08320BTYD0G`:
- `Last-Event-ID: abc` → received events from id 1 (full replay) ✓
- `Last-Event-ID: -1` → received events from id 1 (full replay) ✓
- Both returned id 1 (turn) + id 2 (exit), identical to no-header behavior

All assertions confirmed.
