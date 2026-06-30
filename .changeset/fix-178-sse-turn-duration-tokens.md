---
"@sumeru/core": minor
"@sumeru/adapter-core": minor
"@sumeru/host": patch
"@sumeru/adapter-hermes": patch
"@sumeru/adapter-claude-code": patch
"@sumeru/adapter-codex": patch
"@sumeru/sarsapa": patch
---

fix: SSE turn events report wall-clock durationMs and pass tokenUsage through (#178)

`event: turn` previously emitted `durationMs: 0` for any pure-text assistant turn
and `tokenUsage: { input: 0, output: 0, cached: 0 }` whenever the adapter did not
report tokens — surfacing "unknown" as "zero". Root causes were `wire-turn.ts`
deriving `durationMs` from `sumToolDuration()` (only tool-call time) and falling
back to an `EMPTY_TOKEN_USAGE` constant, plus `adapter-hermes` never attaching
`usage_update` tokens to the per-turn frame.

Changes:
- **@sumeru/core** — `AssistantTurn.tokenUsage` widened to `TokenUsage | null` so
  "unknown" is representable (`null`) instead of a fabricated zero object.
- **@sumeru/adapter-core** — `TurnValue` gains a `durationMs: number | null` field
  so producers can carry a measured wall-clock duration; `null` means the host
  derives it from frame-arrival timing.
- **@sumeru/host** — `wire-turn.ts` passes `tokens` through unchanged and emits a
  positive-integer wall-clock `durationMs` (clamped to `>= 1`); the session
  manager measures per-turn wall-clock (boundary = prior turn arrival, or send
  start for the first turn) and stamps it onto turn frames before recording.
- **@sumeru/adapter-hermes** — `usage_update` tokens are now attributed to the
  next flushed turn (and consumed so they are never double-counted); the trailing
  `done` frame still carries the cumulative usage.
- **@sumeru/adapter-claude-code**, **@sumeru/adapter-codex**, **@sumeru/sarsapa** —
  updated `TurnValue` construction for the new `durationMs` field (sarsapa now
  reports real per-iteration wall-clock; the others leave it `null` for the host
  to derive).

Refs: #178
