---
scenario: "After ready, each stdin {type:'message', value: InboxMessage} line drives impl.handle(msg); every AsyncGenerator yield is written as {type:'turn', value: TurnValue} and the generator's return value is written as exactly one {type:'done', value: DoneValue}, in order"
feature: adapter-core
tags: [adapter-core, entrypoint, message, handle, turn, done, async-generator, streaming, m1-3, issue-124]
---

## Given
- `createAdapterEntry(impl)` has already completed the init handshake and emitted
  `{ type: "ready", value: {} }` (see `adapter-core-init-ready-handshake.md`).
- The entrypoint reads subsequent stdin NDJSON lines of the form
  `{ type: "message", value: InboxMessage }`, where
  `InboxMessage = { messageId: string; content: string; project: string | null }`.
- A test `impl.handle` is an `AsyncGenerator<TurnValue, DoneValue>` that, for a given
  message, yields two turns then returns a done value, e.g.:
  ```typescript
  async function* handle(message: InboxMessage): AsyncGenerator<TurnValue, DoneValue> {
    yield { index: 0, role: "assistant", content: `re: ${message.content}`,
            timestamp: "2026-06-27T00:00:00.000Z", toolCalls: null, tokens: null };
    yield { index: 1, role: "assistant", content: "done thinking",
            timestamp: "2026-06-27T00:00:01.000Z", toolCalls: null, tokens: null };
    return { summary: "ok", tokenUsage: { input: 10, output: 20 } };
  }
  ```
- A representative message line:
  ```json
  {"type":"message","value":{"messageId":"msg_01JXYZ","content":"hello","project":null}}
  ```

## When
- The test writes the single message line above (plus `\n`) to stdin after `ready`.

## Then
- `impl.handle` is called **exactly once** with `message` deep-equal to the frame `value`:
  `messageId === "msg_01JXYZ"`, `content === "hello"`, `project === null`.
- **Every `yield`** of the generator is written to stdout as one NDJSON line that JSON-parses
  to `{ type: "turn", value: <the yielded TurnValue> }`. For the example, stdout contains two
  `turn` lines, in yield order, whose `value` deep-equals the first then the second yielded
  turn (preserving `index` 0 then 1).
- **The generator's `return` value** is written as **exactly one** trailing line that
  JSON-parses to `{ type: "done", value: <the returned DoneValue> }` — here
  `{ type: "done", value: { summary: "ok", tokenUsage: { input: 10, output: 20 } } }`.
- **Ordering & framing:** for this message the stdout byte stream is exactly, in order:
  `turn`(index 0) `\n` `turn`(index 1) `\n` `done` `\n`. The `done` frame is emitted once and
  only after the generator completes; no `turn` follows `done` for that message.
- **Streaming (not buffered):** turns are flushed as they are yielded, not collected and
  written at the end. (Test: a `handle` that yields turn #0, then `await`s a deferred promise
  before yielding turn #1 → assert the first `turn` line is observable on stdout *before* the
  deferred resolves.)
- **Multiple messages, sequential:** writing two message lines results in two independent
  `handle` invocations whose `turn…done` blocks appear in stdin arrival order and do **not**
  interleave — the entrypoint fully drains one message's generator (through its `done`) before
  starting the next. A second message reuses the same ready process (no re-`init`, no second
  `ready`).
- **Empty generator:** a `handle` that yields nothing and just returns a `DoneValue` produces
  zero `turn` lines and exactly one `done` line.
- The Vitest unit test in `packages/adapter-core/tests/` feeds messages through the in-memory
  stdin, parses stdout NDJSON, and asserts the turn/done sequence, ordering, count, and the
  streaming-before-completion property. `pnpm run test` exits 0.
