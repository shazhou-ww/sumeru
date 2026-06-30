---
tc: tokenUsage is null (not {0,0,0}) when adapter does not report tokens
spec: specs/sse/turn-event-token-usage/spec.md
covers: [Scenario 2]
tags: [sse, turns, token-usage, manual]
execution: MANUAL
---

# TC: tokenUsage is null when adapter does not report tokens

## Objective

Verify that when an adapter does NOT include token data in its turn frame
(`TurnValue.tokens === null`), the SSE turn event outputs `tokenUsage: null`
rather than the incorrect `{input: 0, output: 0, cached: 0}`.

## Why MANUAL

This test requires an adapter that deliberately omits token reporting from its
turn frames. The standard `hermes` prototype uses adapters (Claude, OpenAI) that
always report tokens. To trigger the `null` path, one would need:

- A custom adapter that returns `tokens: null` in its `TurnValue`, or
- A mock/stub adapter for testing purposes, or
- An adapter hitting a provider that doesn't report usage (some local models)

## Preconditions

- Sumeru Host running
- An adapter configured to NOT report token usage (custom/mock adapter)
- Or: direct inspection of `wire-turn.ts` logic to confirm `null` passthrough

## Steps

1. **Configure a session** with an adapter that omits `tokens` from turn frames.

2. **Create a session** and let it complete.

3. **Fetch the assistant turn** and inspect `tokenUsage`.

## Expected Results

- `tokenUsage` field is present in the turn JSON
- `tokenUsage` value is `null` (JSON null)
- `tokenUsage` is NOT `{input: 0, output: 0, cached: 0}`

```json
{
  "id": 0,
  "role": "assistant",
  "content": "...",
  "toolCalls": [],
  "tokenUsage": null,
  "durationMs": 47,
  "timestamp": "2026-06-30T02:19:18.903Z"
}
```

## Code-Level Verification

Confirm in `packages/host/src/wire-turn.ts` that:

1. `EMPTY_TOKEN_USAGE` constant is removed or no longer used for assistant turns
2. When `wire.tokens === null`, the output `tokenUsage` is `null`
3. The type `AssistantTurn.tokenUsage` is `TokenUsage | null`

```typescript
// Expected implementation (after #178 fix):
tokenUsage: wire.tokens ?? null,  // NOT wire.tokens ?? EMPTY_TOKEN_USAGE
```

## Notes

- Before #178: `tokenUsage = wire.tokens ?? { input: 0, output: 0, cached: 0 }`
- After #178: `tokenUsage = wire.tokens ?? null`
- This ensures consumers can distinguish "zero tokens used" from "unknown usage"
