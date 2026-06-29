---
scenario: "Streaming spawn provides line-by-line stdout access before process exit for all NDJSON adapters"
feature: adapter-streaming-spawn
tags: [adapter, streaming, spawn, shared, readline]
---

## Given
- All three NDJSON adapters (claude-code, cursor-agent, codex) have identical `spawn.ts` files: `defaultSpawn` wraps `node:child_process.spawn`, collects stdout chunks into `Buffer[]`, then `Buffer.concat().toString()` after child `close` event.
- The child process `child.stdout` is a `Readable` stream — data arrives incrementally, but `defaultSpawn` only surfaces it after `close`.
- `node:readline.createInterface({ input: stream })` wraps a `Readable` into a line-by-line `AsyncIterable<string>` (the `line` event).
- Each adapter needs access to stdout lines incrementally (for the incremental parser) while still needing post-exit metadata (exitCode, signal, timedOut, durationMs, stderr).
- The three adapters share the same `SpawnArgs` shape: `{ command, args, timeoutMs, cwd }`.
- The three adapters share the same timeout behavior: SIGTERM at timeout, SIGKILL after 5s grace.
- All three adapters' `types.ts` will add the same `SpawnExitInfo`, `SpawnStreamResult`, `StreamingSpawnFn` types.

## When
Each adapter's `spawn.ts` adds `defaultStreamingSpawn`:

```typescript
export const defaultStreamingSpawn: StreamingSpawnFn = ({
  command, args, timeoutMs, cwd,
}: SpawnArgs): SpawnStreamResult => {
  // 1. Spawn child with stdio: ["ignore", "pipe", "pipe"]
  const child = spawn(command, args, { ... });
  
  // 2. Setup timeout (SIGTERM → SIGKILL)
  // ...

  // 3. Buffer stderr
  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", chunk => stderrChunks.push(chunk));

  // 4. Create readline interface for line-by-line stdout
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

  // 5. Return { lines, waitForExit() }
  return {
    lines: rl,                          // AsyncIterable<string>
    waitForExit: () => exitPromise,     // resolves on child "close"
  };
};
```

Key behaviors:
- `lines` is consumed by the incremental parser via `for await (const line of lines)`.
- The `for await` loop naturally ends when the readline interface closes (after child stdout ends).
- `waitForExit()` resolves AFTER stdout is drained — caller awaits it after consuming lines to get the full exit metadata.
- If the child fails to spawn (ENOENT, EACCES), the `spawn` call throws synchronously — the function propagates this as a thrown error.
- If timeout fires BEFORE stdout is fully consumed, the SIGTERM is sent. The readline interface will end (child.stdout emits `end`). `waitForExit()` will resolve with `timedOut: true`.
- `stderr` is buffered in-process and available only via `waitForExit()` — NOT streamed.
- The `defaultStreamingSpawn` is NOT async — it returns `SpawnStreamResult` synchronously (the spawn itself is synchronous; only consuming lines/exit is async).

## Then
- Each adapter's `spawn.ts` exports `defaultStreamingSpawn: StreamingSpawnFn` alongside the existing `defaultSpawn: SpawnFn`.
- `defaultStreamingSpawn` returns immediately with `{ lines, waitForExit() }`.
- `lines` yields one complete stdout line per iteration (no partial lines, no buffered-then-flushed).
- `waitForExit()` resolves with `{ exitCode, signal, timedOut, durationMs, stderr }` after the child process exits.
- On timeout: SIGTERM sent, 5s grace, then SIGKILL. `timedOut: true` in exit info. Lines stop yielding (readline closes).
- On spawn error (ENOENT, EACCES): function throws synchronously.
- `stderr` is fully available in `SpawnExitInfo.stderr` (concatenated from buffered chunks).
- The existing `defaultSpawn` is unchanged — `createSession` still uses it.
- Both spawn functions accept the same `SpawnArgs` type.
- The `StreamingSpawnFn` type is injectable via adapter options (test seam) just like `SpawnFn`.
- `pnpm run build` exits 0 for all three adapter packages.
