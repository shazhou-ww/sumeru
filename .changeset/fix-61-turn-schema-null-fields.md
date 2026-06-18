---
"@sumeru/server": patch
---

Align turn schema spec with implementation: `toolCalls[].output` and `toolCalls[].durationMs` now document `null` as a valid value (anyOf null/string and null/integer respectively), matching the existing code in `packages/server/src/ocas/schemas.ts`.
