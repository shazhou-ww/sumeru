---
scenario: "createCodexAdapter().createSession spawns `codex exec [PROMPT] --json` and parses the JSONL stream for the session ID, returning a NativeSessionRef"
feature: adapter-codex
tags: [adapter, codex, openai, create-session]
---

## Given
- `@sumeru/adapter-codex` is built. The factory `createCodexAdapter(options)` returns an `Adapter` with `name: "codex"`.
- The Codex CLI (`codex`) is installed and on PATH, or the caller has passed `codexBin` pointing to the executable.
- The CLI is authenticated (e.g., `OPENAI_API_KEY` is set in the environment).
- A test harness exists with a mock `spawnFn` that returns captured JSONL fixtures (see spike spec for fixture generation).

## When
- The consumer calls:
  ```typescript
  const adapter = createCodexAdapter({ cwd: "/some/project" });
  const ref = await adapter.createSession({ initialQuery: "ping", model: "o3" });
  ```

## Then
- The adapter spawns (via `spawnFn` or `defaultSpawn`):
  ```
  codex exec "ping" --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /some/project -m o3
  ```
  Flags breakdown:
  - `exec "ping"` — one-shot execution with the initial query
  - `--json` — emit JSONL to stdout for structured parsing
  - `--dangerously-bypass-approvals-and-sandbox` — skip interactive permission prompts (configurable via `dangerouslyBypassApprovals` option, default `true`)
  - `--skip-git-repo-check` — allow running outside git repos (configurable via `skipGitRepoCheck` option, default `true`)
  - `-C /some/project` — set working directory
  - `-m o3` — model selection (omitted if `model` is `null`)
- The adapter parses the JSONL output to extract:
  - `sessionId` — the native session identifier for resume (exact field TBD by spike, likely from a `system` or `session_start` event)
  - `model` — the model used (for metadata)
  - Initial turns — rewritten to start at index 0, cached in-memory keyed by `sessionId`
- If the process times out (exceeds `createSessionTimeoutMs`), the adapter throws:
  ```
  createSession timed out after 300000ms
  ```
- If the process exits with a non-zero code and no parseable session ID, the adapter throws with stderr context:
  ```
  codex exited with code <N>: <stderr tail>
  ```
- If the JSONL output is unparseable (no session ID line), the adapter throws:
  ```
  codex returned unparseable json output (bin=codex, first 500 chars: ...)
  ```
- On success, returns a `NativeSessionRef`:
  ```typescript
  {
    nativeId: "<session-id-from-jsonl>",
    meta: {
      cwd: "/some/project",
      model: "o3",  // or null if not specified
      createdAt: "<ISO-8601 timestamp>",
      // ... other metadata from the JSONL output
    }
  }
  ```
- The initial turns (if any) are cached in-memory. `getTurns(ref)` immediately returns them.
- The adapter's in-memory state is keyed by `nativeId` — multiple sessions can coexist.

## Error cases
- **Auth error** — If stderr contains API key or authentication errors, throw a descriptive error:
  ```
  codex exited with code <N>: codex API key error. Check your OPENAI_API_KEY configuration.
  ```
- **Not installed** — If spawn fails (e.g., ENOENT), throw:
  ```
  codex adapter failed to spawn 'codex': spawn codex ENOENT
  ```

## Tests
- Unit test with mock `spawnFn` returning a captured success fixture → asserts `nativeId` is extracted correctly.
- Unit test with mock returning timeout → asserts timeout error.
- Unit test with mock returning non-zero exit + auth error stderr → asserts auth error message.
- Unit test with mock returning empty/garbage output → asserts unparseable error.
