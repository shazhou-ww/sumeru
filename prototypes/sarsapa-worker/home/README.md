# Sarsapa worker HOME template

Sarsapa's `init()` stores `instructions` as the in-memory conversation system
prompt — it does **not** write CLAUDE.md / SOUL.md / config files into HOME
(unlike claude-code / hermes adapters). So this home template is intentionally
empty.

HOME is still mounted per-instance for the agent's working files (installed
packages, intermediate artifacts) under `/home/node/`.
