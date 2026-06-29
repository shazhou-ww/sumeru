---
scenario: "A dummy AdapterImpl driven through createAdapterEntry exercises the complete lifecycle end-to-end: init→ready, two messages each streaming turn(s)→done, then stdin close→graceful exit — proving the NDJSON protocol round-trips over mocked stdin/stdout"
feature: adapter-core
tags: [adapter-core, entrypoint, e2e, lifecycle, dummy-adapter, ndjson, mock-stdio, m1-3, issue-124]
---

## Given
- `@sumeru/adapter-core` exports `createAdapterEntry`, `AdapterImpl`, `AdapterInitConfig`,
  `SkillContent` and is wired to an injectable stdin/stdout pair (see
  `adapter-core-types-contract.md` and `adapter-core-init-ready-handshake.md`).
- The issue #124 acceptance explicitly requires a dummy adapter impl that validates the full
  lifecycle. The dummy `impl` is defined in the test:
  ```typescript
  const initCalls: AdapterInitConfig[] = [];
  const dummy: AdapterImpl = {
    async init(config) { initCalls.push(config); },
    async *handle(message) {
      yield { index: 0, role: "assistant", content: `echo:${message.content}`,
              timestamp: "2026-06-27T00:00:00.000Z", toolCalls: null, tokens: null };
      return { summary: `handled ${message.messageId}`, tokenUsage: { input: 1, output: 2 } };
    },
  };
  ```
- The test harness builds in-memory `stdin` and `stdout` streams (e.g. `PassThrough`),
  collects everything written to `stdout`, and splits it into NDJSON frames.

## When
- The test calls `createAdapterEntry(dummy)` wired to the in-memory streams, then writes the
  following lines to stdin, each terminated by `\n`, in order:
  1. `{"type":"init","value":{"instructions":"i","skills":[],"model":{"provider":"anthropic","name":"m","apiKey":"test-key","contextWindow":1000}}}`
  2. `{"type":"message","value":{"messageId":"msg_A","content":"alpha","project":null}}`
  3. `{"type":"message","value":{"messageId":"msg_B","content":"beta","project":"proj1"}}`
- The test then **ends** stdin (EOF) and waits for the entrypoint to settle.

## Then
- **Init:** `initCalls.length === 1` and `initCalls[0]` deep-equals the init `value`.
- **Full ordered stdout frame sequence** (parsing every NDJSON line in order) is exactly:
  1. `{ type: "ready", value: {} }`
  2. `{ type: "turn", value: { index: 0, role: "assistant", content: "echo:alpha", timestamp: "2026-06-27T00:00:00.000Z", toolCalls: null, tokens: null } }`
  3. `{ type: "done", value: { summary: "handled msg_A", tokenUsage: { input: 1, output: 2 } } }`
  4. `{ type: "turn", value: { index: 0, role: "assistant", content: "echo:beta", timestamp: "2026-06-27T00:00:00.000Z", toolCalls: null, tokens: null } }`
  5. `{ type: "done", value: { summary: "handled msg_B", tokenUsage: { input: 1, output: 2 } } }`
  — i.e. exactly **5** frames: one `ready`, then per message a `turn` block closed by a single
  `done`, with `msg_A`'s block fully preceding `msg_B`'s (no interleaving, no second `ready`,
  no re-`init`).
- **`project` passthrough:** the second message's generator received `message.project === "proj1"`
  (asserted by capturing the argument inside the dummy, or via content), confirming
  `InboxMessage.project` reaches `impl.handle` unchanged.
- **Graceful exit:** after stdin EOF, the `createAdapterEntry` completion settles cleanly with
  no thrown error and no extra frames emitted after the last `done`; the process is left ready
  to exit `0`.
- **Well-formed wire format:** every emitted line is valid JSON, newline-terminated, and one
  frame per line (no concatenated or split frames); each parses to a frame whose `type` is one
  of `ready | turn | done`.
- This end-to-end test lives in `packages/adapter-core/tests/` (e.g.
  `entrypoint-lifecycle.test.ts`), uses only mocked stdio (no child process, no real signals),
  and passes under `pnpm run test`. `pnpm run build` and `pnpm run check` also exit 0.
- A `.changeset/<slug>.md` declares `@sumeru/adapter-core` as a `minor` bump (initial
  publishable entrypoint surface) with a one-line description referencing #124.
