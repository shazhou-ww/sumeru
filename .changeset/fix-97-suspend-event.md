---
"@sumeru/core": minor
"@sumeru/adapter-claude-code": minor
"@sumeru/adapter-codex": minor
"@sumeru/adapter-cursor-agent": minor
"@sumeru/adapter-hermes": minor
"@sumeru/server": minor
---

Add a `suspend` terminal event to the adapter send protocol (RFC #95 Phase 1).

`@sumeru/core` `SendEvent` gains a fourth, terminal variant
`{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }`,
a peer of `done`/`error`. On a send timeout, all four adapters
(claude-code, codex, cursor-agent, hermes) now yield this `suspend` event —
carrying the agent's `nativeId` and the wall-clock `elapsedMs` — instead of an
`error`, then return through the existing close path. The timed-out process is
still SIGKILLed; `suspend` only records the checkpoint for a future resume
(Phase 2). The server SSE stream emits a terminal `event: suspend` frame with a
`{ type: "@sumeru/suspend", value: { reason, nativeId, elapsedMs } }` envelope
(symmetric to `@sumeru/error`), then closes and returns the session to `idle`.
A timeout is now conveyed only as `event: suspend`, never as `event: error`.
