---
"@sumeru/adapter-codex": minor
"@sumeru/cli": minor
---

Add OpenAI Codex CLI adapter (@sumeru/adapter-codex) with support for session resume via `codex exec resume`. The adapter spawns `codex exec --json` for structured JSONL output parsing, with configurable flags for `--dangerously-bypass-approvals-and-sandbox` and `--skip-git-repo-check` for unattended operation.
