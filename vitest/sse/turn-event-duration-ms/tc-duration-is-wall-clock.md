---
tc: durationMs reflects wall-clock time, not just tool execution time
spec: specs/sse/turn-event-duration-ms/spec.md
covers: [Scenario 2, Scenario 3]
tags: [sse, turns, duration, wall-clock, automated]
---

# TC: durationMs is wall-clock elapsed time

## Objective

Verify that `AssistantTurn.durationMs` represents the actual wall-clock time
from when the adapter call started to when the turn completed — not just the sum
of tool call durations. Even for a simple text reply (no tools), durationMs must
be positive since it includes adapter inference + network latency.

## Preconditions

- Sumeru Host running at `http://127.0.0.1:7901`
- Prototype `hermes` available
- Docker running with `sumeru/hermes:dev` image

## Steps

1. **Create a session** with a task that will take measurable inference time:

```bash
START_MS=$(date +%s%3N)
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"hermes","project":"sumeru","task":"Reply with just the word hello"}' \
  | jq -r '.id')
```

2. **Wait for session to complete**:

```bash
for i in $(seq 1 60); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.status')
  [ "$STATUS" = "idle" ] && break
  sleep 1
done
END_MS=$(date +%s%3N)
WALL_MS=$((END_MS - START_MS))
```

3. **Fetch the assistant turn** and compare:

```bash
TURNS=$(curl -s http://127.0.0.1:7901/sessions/$SID/turns)
DURATION=$(echo "$TURNS" | jq '.[0].durationMs')
```

## Expected Results

- `DURATION >= 1` (positive integer, even with no tool calls)
- `DURATION` is a reasonable approximation of wall-clock time for the adapter call
  (will be less than total `WALL_MS` since WALL_MS includes polling overhead)
- `DURATION` does NOT equal 0 (the old bug where `sumToolDuration([]) == 0`)
- For a simple "hello" reply, `DURATION` should be in the range of hundreds to
  thousands of milliseconds (reflecting LLM inference time)

## Verification Command

```bash
echo "$TURNS" | jq --argjson wall "$WALL_MS" '.[0] | select(.role == "assistant") |
  if .durationMs >= 1 and .durationMs <= $wall
  then "PASS: durationMs=\(.durationMs) wall=\($wall)"
  else "FAIL: durationMs=\(.durationMs) wall=\($wall) (expected 1 <= duration <= wall)"
  end'
```

## Notes

- The reported `durationMs` should be ≤ total wall-clock time (since wall-clock
  includes our polling sleep overhead).
- The key invariant is `durationMs >= 1` — it must never be 0 for an assistant turn.
- Before #178 fix: `durationMs = sumToolDuration([]) = 0` for no-tool turns.
- After #178 fix: `durationMs = wallClockElapsed >= 1`.
