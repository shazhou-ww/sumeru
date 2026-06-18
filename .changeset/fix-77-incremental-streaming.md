---
"@sumeru/adapter-claude-code": minor
"@sumeru/adapter-cursor-agent": minor
"@sumeru/adapter-codex": minor
---

Implement true incremental streaming for all NDJSON adapters (Fixes #77)

Add `defaultStreamingSpawn` (returns `{lines, waitForExit()}` synchronously) and `parseStreamJsonIncremental` / `parseCodexJsonIncremental` async generators. Rewrite `send()` to yield turn events as each line is parsed from stdout — before the child process exits — with immediate turnsCache updates. Tool-result events fill in `ToolCall.output` on previously-yielded Turn objects via reference sharing.
