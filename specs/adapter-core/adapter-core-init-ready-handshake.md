---
scenario: "createAdapterEntry reads the first stdin NDJSON line {type:'init', value: AdapterInitConfig}, awaits impl.init(config), then writes exactly one {type:'ready', value:{}} line to stdout before processing any message"
feature: adapter-core
tags: [adapter-core, entrypoint, init, ready, handshake, ndjson, lifecycle, m1-3, issue-124]
---

## Given
- `@sumeru/adapter-core` exports `createAdapterEntry(impl: AdapterImpl): void`
  (see `adapter-core-types-contract.md`).
- The entrypoint communicates over an injectable stdin/stdout pair so it is unit-testable
  without a real process. The factory reads from a `NodeJS.ReadableStream` and writes to a
  `NodeJS.WritableStream`, defaulting to `process.stdin` / `process.stdout`; tests pass
  in-memory streams (e.g. `PassThrough`) instead. (The exact injection seam — a second
  options argument, or an internal `runAdapterEntry({ impl, stdin, stdout })` that
  `createAdapterEntry` wraps — is an implementation choice, but a test seam MUST exist;
  unit tests do not spawn a child process.)
- The wire protocol is **NDJSON**: one JSON value per line, each line terminated by a
  single `\n`. Frames are parsed line-by-line (a partial trailing line is buffered until
  its newline arrives).
- A test `impl` is supplied whose `init` records the received config and resolves; for this
  spec `handle` is never expected to be called.
- A representative init line:
  ```json
  {"type":"init","value":{"instructions":"You are a worker.","skills":[{"name":"tdd","content":"# TDD"}],"model":{"provider":"anthropic","name":"claude-sonnet-4","apiKeyEnv":"ANTHROPIC_API_KEY","contextWindow":200000}}}
  ```

## When
- The test calls `createAdapterEntry(impl)` (wired to the in-memory streams) and writes the
  single init line above to stdin, followed by `\n`.

## Then
- `impl.init` is called **exactly once**, with `config` deep-equal to the `value` of the init
  frame: `instructions === "You are a worker."`, `skills` is `[{ name: "tdd", content: "# TDD" }]`,
  and `model` deep-equals the provided `ModelConfig`.
- The entrypoint **awaits** `impl.init` before emitting anything: the `ready` frame is written
  only after the `init` promise resolves. (Test: make `init` block on a deferred promise →
  assert no stdout bytes yet → resolve the deferred → assert `ready` now appears.)
- After `init` resolves, stdout receives **exactly one** line that JSON-parses to
  `{ type: "ready", value: {} }`, terminated by a single `\n`. No other bytes precede it.
- The `init` frame itself produces **no** `turn` or `done` output — `ready` is the only
  response to `init`.
- Ordering invariant: `ready` is always the **first** outbound frame of the process lifetime;
  any later message handling (covered in `adapter-core-message-handling.md`) happens strictly
  after `ready` has been flushed.
- If `impl.init` **rejects**, the entrypoint does NOT write `ready`; it surfaces the failure
  (writes a terminal `{ type: "error", value: { code, message } }` frame and/or exits non-zero)
  rather than proceeding to read messages. (Exact error code is asserted in
  `adapter-core-shutdown-and-errors.md`.)
- The corresponding Vitest unit test in `packages/adapter-core/tests/` drives the in-memory
  streams, parses stdout NDJSON, and asserts the single `ready` frame and the one `init` call.
  `pnpm run test` exits 0.
