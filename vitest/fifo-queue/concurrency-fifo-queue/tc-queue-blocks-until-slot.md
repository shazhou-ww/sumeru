---
id: tc-queue-blocks-until-slot
spec: concurrency-fifo-queue
tags: [session, concurrency, queue, blocking]
prerequisites:
  - Sumeru Host running at port 7901 with maxRunning=2
  - No running sessions (clean state)
  - prototype 'hermes' available
---

# TC: Queue Blocks Until Slot Released

## Objective

Verify that when maxRunning=2 and both slots are occupied, a 3rd session
create request blocks (long-polls) until a slot is freed by stopping a
running session, then returns 201.

## Steps

1. Create session S1 (long task) → expect 201, status=running
2. Create session S2 (long task) → expect 201, status=running
3. Verify GET / shows running=2, queued=0
4. Send POST /sessions for S3 in background (should block)
5. Wait briefly, verify GET / shows running=2, queued=1
6. Stop S1 via POST /sessions/{id}/stop
7. Wait for S3 background request to complete → expect 201
8. Verify GET / shows running=2 (S2 + S3), queued=0

## Expected Results

- Step 3: `status.running == 2`
- Step 5: `status.queued == 1` (3rd request is waiting)
- Step 7: S3 creation returns HTTP 201 with status=running
- Step 8: `status.running == 2`, `status.queued == 0`
