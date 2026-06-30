---
"@sumeru/host": patch
---

fix(host): survive abnormal adapter subprocess exits (#177)

E2E runs that sequentially created 3-5 sessions then issued interleaved
DELETE/GET calls could crash the host process, leaving subsequent requests
with `Connection refused` until a manual restart. Root cause: the detached
`readAdapterOutput` read loop is fire-and-forget (never `await`-ed, no
`.catch()`), so when an adapter subprocess exits abnormally and its `catch`
path runs against an already-deleted session, the resulting rejection bubbled
up as an `unhandledRejection` with no process-level handler — killing the host.

- Add a process-level `unhandledRejection` guard
  (`packages/host/src/process-guards.ts`, installed from `main.ts`). It only
  logs the reason via `console.error`; it never calls `process.exit()`, so a
  single session's adapter fault can no longer take down the whole host. This
  is the last line of defense for any background task that misses a `.catch()`.
- Lock in the existing `markIdle` missing-session guard with regression tests:
  a late exit/error frame for a deleted session early-returns instead of
  throwing a `TypeError`, and an adapter that dies while still tracked releases
  its running slot (transitions to `idle`/`failed`) rather than leaking it.

The `unhandledRejection` guard and the concrete reject-source guards are
complementary layers of defense; both are exercised by the new tests. The
existing `SIGINT` graceful-shutdown path is unchanged.
