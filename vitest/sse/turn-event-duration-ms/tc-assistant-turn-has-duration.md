---
tc: assistant turn event includes durationMs as a positive integer
spec: specs/sse/turn-event-duration-ms/spec.md
covers: [Scenario 1, Scenario 3]
tags: [sse, turns, duration, automated]
---

# TC: Assistant turn event has durationMs ≥ 1

## Objective

Verify that an assistant turn (even a simple text-only reply with no tool calls)
includes `durationMs` as a positive integer (≥ 1), confirming the #178 fix.

## Preconditions

- Sumeru Host running at `http://127.0.0.1:7901`
- Prototype `hermes` available
- Docker running with `sumeru/hermes:dev` image

## Steps

1. **Create a session** with a trivial task (pure text reply, no tools needed):

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"hermes","project":"sumeru","task":"Reply with just the word hello"}' \
  | jq -r '.id')
echo "Session: $SID"
```

2. **Wait for session to reach idle** (turn complete):

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.status')
  [ "$STATUS" = "idle" ] && break
  sleep 1
done
```

3. **Fetch turns** and extract the assistant turn's `durationMs`:

```bash
TURNS=$(curl -s http://127.0.0.1:7901/sessions/$SID/turns)
DURATION=$(echo "$TURNS" | jq '.[0].durationMs')
ROLE=$(echo "$TURNS" | jq -r '.[0].role')
```

## Expected Results

- `ROLE` == `"assistant"`
- `DURATION` is a JSON number (integer), not null, not a string
- `DURATION >= 1`
- `DURATION` is a whole number (no decimal places)

## Verification Command

```bash
echo "$TURNS" | jq '.[0] | select(.role == "assistant") |
  if (.durationMs | type) == "number" and .durationMs >= 1 and (.durationMs == (.durationMs | floor))
  then "PASS: durationMs=\(.durationMs)"
  else "FAIL: durationMs=\(.durationMs)"
  end'
```
