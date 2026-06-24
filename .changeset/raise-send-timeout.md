---
"@sumeru/adapter-hermes": patch
"@sumeru/adapter-claude-code": patch
"@sumeru/adapter-codex": patch
"@sumeru/adapter-cursor-agent": patch
---

Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
