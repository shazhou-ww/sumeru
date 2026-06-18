---
"@sumeru/server": minor
---

Make `rebuildSearchIndex` walk the ocas store via `listByType` instead of requiring callers to supply roots. The function now takes two arguments `(index, ocas)` — the third `roots` parameter is removed. Internally, the rebuild closure enumerates all `@sumeru/session-meta` and `@sumeru/turn` nodes by schema hash, uses `sumeru_session_turns` for turn→session association, and runs a corrective UPDATE to fix `turn_count`/`last_active_at`. Orphaned turns are skipped with a warn-level log.

Fixes #59
