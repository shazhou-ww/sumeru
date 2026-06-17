---
scenario: "createCodexAdapter().getTurns returns a defensive copy of the in-memory turn cache for a given session"
feature: adapter-codex
tags: [adapter, codex, openai, get-turns]
---

## Given
- `@sumeru/adapter-codex` is built.
- The adapter maintains an in-memory `Map<string, Turn[]>` keyed by `nativeId`.

## When
- The consumer calls:
  ```typescript
  const turns = await adapter.getTurns(ref);
  ```

## Then
- If `nativeId` is in the cache, returns a **defensive copy** (`[...cached]`) of the turns array.
- If `nativeId` is NOT in the cache (unknown session), returns an empty array `[]`.
- The returned array is decoupled from the internal cache — mutations do not affect the adapter's state.

## Behavior across session lifecycle
| State | getTurns returns |
|-------|------------------|
| After `createSession` | Initial turns (if any) from the first spawn |
| After `send` | Initial + delta turns (monotonic indices) |
| After `close` | Same as before close (cache is not evicted) |
| Unknown `nativeId` | `[]` |

## Error cases
- **Invalid ref** — If `ref` is null/undefined or has no `nativeId`, throw:
  ```
  getTurns: invalid NativeSessionRef
  ```

## Tests
- Unit test: after `createSession`, `getTurns` returns the initial turns.
- Unit test: after `send`, `getTurns` returns initial + delta turns.
- Unit test: mutating the returned array does not affect subsequent `getTurns` calls.
- Unit test: `getTurns` for an unknown `nativeId` returns `[]`.
- Unit test: `getTurns({ nativeId: "" })` throws "invalid NativeSessionRef".
