---
"@sumeru/adapter-core": minor
---

feat: add @sumeru/adapter-core cli-kit NDJSON entrypoint (M1-3, #124)

Replace the scaffold `VERSION` placeholder with the initial publishable
entrypoint surface defined in package-design wiki §4. The package now exports
the adapter-author contract and a stdin/stdout NDJSON entrypoint framework:

- `AdapterImpl`, `AdapterInitConfig`, `SkillContent` — the contract an adapter
  author implements (`handle` is `AsyncGenerator<TurnValue, DoneValue>`).
- `InboundFrame` / `OutboundFrame` — the NDJSON wire-frame discriminated unions
  (`init`/`message` in; `ready`/`turn`/`done`/`error` out), reusing
  `InboxMessage`/`TurnValue`/`DoneValue`/`ModelConfig`/`ErrorValue` from
  `@sumeru/core`.
- `createAdapterEntry(impl)` — wires an impl to `process.stdin`/`stdout` +
  SIGTERM; `runAdapterEntry({ impl, stdin, stdout, onSigterm })` is the
  injectable seam used by the unit tests.

Behavior: read first `{type:"init"}` line → `await impl.init()` → one
`{type:"ready",value:{}}`; each `{type:"message"}` → drive `impl.handle()`,
streaming every `yield` as a `turn` and the generator `return` as one `done`.
Graceful shutdown on stdin EOF (drains the in-flight generator) and SIGTERM
(idempotent); malformed/pre-init/handler failures surface as a terminal
`error` frame. Covered by Vitest unit + dummy-adapter e2e tests over mocked
stdio.

Refs: #124
