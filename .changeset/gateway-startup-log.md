---
"@sumeru/server": minor
---

Add per-gateway startup logging. After the ocas store line, startServer now prints one line per gateway showing adapter resolution status: `[sumeru] gateway <name> -> adapter @sumeru/adapter-<name> (ready|unavailable: not registered)`.
