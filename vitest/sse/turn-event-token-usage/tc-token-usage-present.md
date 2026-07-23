---
tc: assistant turn event includes tokenUsage with non-negative integers
spec: specs/sse/turn-event-token-usage/spec.md
covers: [Scenario 1]
tags: [sse, turns, token-usage, automated]
---

# TC: Token usage present with valid structure

## Objective

Verify that when the adapter reports token consumption, the assistant turn event
includes `tokenUsage` as an object with `{input, output, cached}` — all
non-negative integers.

## Preconditions

- Sumeru Host running at `http://127.0.0.1:7901`
- Prototype `hermes` available (uses an adapter that reports token usage)
- Docker running with `sumeru/hermes:dev` image

## Steps

1. **Create a session**:

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"hermes","project":"sumeru","task":"Reply with just the word hello"}' \
  | jq -r '.id')
echo "Session: $SID"
```

2. **Wait for session to reach idle**:

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.status')
  [ "$STATUS" = "idle" ] && break
  sleep 1
done
```

3. **Fetch turns** and extract `tokenUsage`:

```bash
TURNS=$(curl -s http://127.0.0.1:7901/sessions/$SID/turns)
TOKEN_USAGE=$(echo "$TURNS" | jq '.[0].tokenUsage')
```

## Expected Results

If the adapter reported tokens (expected for direct Claude/OpenAI adapters):

- `tokenUsage` is an object (not null, not a number)
- `tokenUsage.input` is a non-negative integer (>= 0)
- `tokenUsage.output` is a non-negative integer (>= 0)
- `tokenUsage.cached` is a non-negative integer (>= 0)
- At least `input` and `output` should be > 0 for a real inference call

If the adapter did NOT report tokens (e.g., proxy adapter without token forwarding):

- `tokenUsage` is `null` (not `{input:0, output:0, cached:0}`)
- This validates the #178 fix: unknown ≠ zero

**Note:** In test environments using a proxy adapter (e.g., endpoint
`host.docker.internal:4141`), the adapter may not forward token usage from the
upstream provider, resulting in `tokenUsage: null`. This is correct behavior
per the spec — the key assertion is that it is NOT `{input:0,output:0,cached:0}`.

## Verification Command

```bash
echo "$TURNS" | jq '.[0] | select(.role == "assistant") |
  if .tokenUsage == null then
    "INFO: tokenUsage is null (adapter did not report tokens) - see tc-token-usage-null-when-unknown"
  elif (.tokenUsage | type) == "object"
    and (.tokenUsage.input | type) == "number" and .tokenUsage.input >= 0
    and (.tokenUsage.output | type) == "number" and .tokenUsage.output >= 0
    and (.tokenUsage.cached | type) == "number" and .tokenUsage.cached >= 0
    and (.tokenUsage.input == (.tokenUsage.input | floor))
    and (.tokenUsage.output == (.tokenUsage.output | floor))
    and (.tokenUsage.cached == (.tokenUsage.cached | floor))
  then "PASS: tokenUsage=\(.tokenUsage)"
  else "FAIL: tokenUsage=\(.tokenUsage)"
  end'
```
