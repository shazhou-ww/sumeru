---
id: tc-fifo-order
spec: concurrency-fifo-queue
tags: [session, concurrency, queue, fifo, ordering]
prerequisites:
  - Sumeru Host running at port 7901 with maxRunning=2
  - No running sessions (clean state)
  - prototype 'hermes' available
---

# TC: FIFO Order of Queued Sessions

## Objective

Verify that when multiple create requests are queued, they are served in
FIFO order — the first request queued is the first to get a slot.

## Steps

1. Create session S1 (long task) → expect 201, status=running
2. Create session S2 (long task) → expect 201, status=running
3. Verify GET / shows running=2, queued=0
4. Send POST /sessions for request A in background (should block) — mark with task containing "ALPHA"
5. Wait 1 second
6. Send POST /sessions for request B in background (should block) — mark with task containing "BRAVO"
7. Verify GET / shows running=2, queued=2
8. Stop S1 via POST /sessions/{id}/stop → request A should unblock first
9. Wait for request A to complete → expect 201
10. Verify the completed session's task contains "ALPHA" (FIFO: first-in gets slot first)
11. Verify request B is still pending (queued=1) or stop S2 to release it

## Expected Results

- Step 7: `status.queued == 2`
- Step 9: Request A (ALPHA) completes with 201 before request B (BRAVO)
- Step 10: The session that started has task containing "ALPHA", confirming FIFO order
