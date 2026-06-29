---
scenario: "Tests verify incremental streaming behavior: turns yield before process exit and turnsCache updates mid-stream"
feature: adapter-streaming-tests
tags: [adapter, streaming, tests, incremental, mock]
---

## Given
- All three NDJSON adapters (claude-code, cursor-agent, codex) now implement true incremental streaming via `StreamingSpawnFn` + incremental parser.
- Each adapter's options accept `streamingSpawnFn: StreamingSpawnFn | null` — a test seam for injecting a mock.
- A mock `StreamingSpawnFn` can control the timing of each stdout line independently (e.g. emit lines on a timer, resolve exit only after all lines are consumed).
- The test needs to prove the TIMING property: turns arrive before the process exits.
- The test needs to prove the CACHE property: `getTurns` returns partial results mid-stream.

## When
Each adapter package adds a test file `packages/adapter-<name>/tests/incremental-streaming.test.ts`:

### Mock StreamingSpawnFn pattern

```typescript
function createMockStreamingSpawn(lines: string[], exitDelay: number) {
  let exitResolve: () => void;
  let exited = false;
  const exitPromise = new Promise<SpawnExitInfo>((resolve) => {
    exitResolve = () => {
      exited = true;
      resolve({
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 100,
        stderr: "",
      });
    };
  });

  const streamingSpawnFn: StreamingSpawnFn = () => ({
    lines: (async function* () {
      for (const line of lines) {
        yield line;
        // small delay to simulate real streaming
        await new Promise(r => setTimeout(r, 10));
      }
      // wait before resolving exit to prove turns yield first
      setTimeout(exitResolve, exitDelay);
    })(),
    waitForExit: () => exitPromise,
  });

  return { streamingSpawnFn, isExited: () => exited };
}
```

### Test: turns yield before process exit (per adapter)

1. Build NDJSON lines for the adapter's format:
   - claude-code: `system` line + `assistant` line + `result` line.
   - cursor-agent: `system` line + `assistant` line + `tool_call started` + `tool_call completed` + `result` line.
   - codex: `session.start` line + `message` (assistant) line + `session.end` line.
2. Create adapter with mock `streamingSpawnFn` (exitDelay: 200ms).
3. Call `createSession` (using batch `spawnFn` mock as before).
4. Call `adapter.send(ref, "test prompt")`.
5. Iterate the returned `AsyncIterable<SendEvent>`:
   - On first `{ type: "turn" }` event: assert `isExited()` is `false`.
   - On `{ type: "done" }` event: assert `isExited()` is `true`.
6. Assert total turn count matches expected.

### Test: turnsCache updates mid-stream (per adapter)

1. Same mock setup with multiple assistant lines (3+ turns).
2. Partially consume the async iterable (take first turn event only).
3. Call `adapter.getTurns(ref)`:
   - Assert it includes the initial `createSession` turns PLUS the just-yielded turn.
4. Consume the rest of the iterable.
5. Call `adapter.getTurns(ref)` again:
   - Assert it includes ALL turns (createSession + all send turns).

### Test: error mid-stream preserves already-yielded turns (per adapter)

1. Mock emits 2 assistant turns, then exit with non-zero code.
2. Iterate: expect 2 `turn` events, then 1 `error` event.
3. After iteration: `getTurns` returns the 2 turns that were yielded before the error.

### Test: incremental parser equivalence

1. Prepare a fixed NDJSON string with known turns.
2. Parse with `parseStreamJson` / `parseCodexJson` (batch) — collect resulting turns.
3. Parse the same lines via `parseStreamJsonIncremental` / `parseCodexJsonIncremental` — collect yielded turn events.
4. Assert the turn arrays are deeply equal (same content, same indices, same toolCalls).

## Then
- Each adapter package has `tests/incremental-streaming.test.ts`.
- All tests in `pnpm run test` pass.
- The "turns before exit" test proves the **timing** property — turns are received while the child process is still running.
- The "turnsCache mid-stream" test proves the **cache** property — `getTurns` is accurate mid-stream.
- The "error preserves turns" test proves **fault tolerance** — partial progress is retained.
- The "parser equivalence" test proves **correctness** — the incremental parser produces the same output as the batch parser.
- No flaky timing: the mock controls sequencing deterministically (the 10ms delay + 200ms exitDelay provide sufficient separation; tests do NOT rely on wall-clock races).
