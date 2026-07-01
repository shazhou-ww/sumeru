---
"@sumeru/adapter-cursor-agent": minor
---

Add Cursor Agent adapter (`@sumeru/adapter-cursor-agent`). Spawns `cursor-agent` CLI with `--print --output-format stream-json --trust --force` flags, parses NDJSON turns including separate `tool_call` events with `started`/`completed` subtypes, supports resume via `--resume <sessionId>`.
