---
scenario: "After S1 bootstrap, a single message POSTed to the reserved master inst_0 inbox lazily cold-starts the hermes master adapter (`hermes acp`, creds from ~/.hermes/config.yaml) and produces a real agent roundtrip: POST inbox returns 202 @sumeru/inbox-accepted with a messageId, and the inst_0 outbox SSE stream emits the live frame sequence (heartbeat?) -> turn(role:assistant, content:\"pong\") -> done, after which the server closes the stream (res.end). This is v2's first scenario that actually spins up an agent and reaches a model."
feature: master-roundtrip
tags: [host, master, inst_0, inbox, outbox, sse, roundtrip, adapter-hermes, hermes-acp, m1, examples-minimal, s2]
---

## Given
- S1 bootstrap holds: repo built (`pnpm install && pnpm run build`), `examples/minimal/` v2
  tree loaded, master `inst_0` seeded at boot via local transport (`status: running`,
  `containerId: "master"`), and **no adapter process spawned yet**. Host started from the
  **repo root**:
  ```bash
  SUMERU_PORT=7912 node packages/host/dist/main.js examples/minimal
  ```
  `GET /` → `@sumeru/host` and `GET /instances/inst_0/status` → `running` confirm liveness
  before any inbox traffic.
- `examples/minimal/host.yaml` sets
  `master.config.command = ["node","packages/adapter-hermes/dist/main.js"]` (resolved relative
  to the repo-root cwd by `resolveMasterAdapterCommand`). The `@sumeru/adapter-hermes` process
  internally drives `hermes acp` and reads model credentials from `~/.hermes/config.yaml`
  (**not** from env).
- `~/.hermes/config.yaml` is present with a usable provider (observed:
  `model.provider: custom:copilot-sora`, `model.default: claude-opus-4.8`). A valid provider is
  the precondition for the cold-started adapter to actually reach a model; with no/invalid
  credentials the expected outcome is an `event: error` frame instead of `turn`/`done`
  (see Gaps).
- Inbox/outbox wiring (verbatim, from `packages/host/src/handlers/{inbox,outbox}.ts` and
  `instance-manager.ts` `submitInbox`):
  - **inbox**: `POST /instances/inst_0/inbox`, JSON body `{"content":"<msg>"}` (`project`
    optional). `content` must be a non-empty string (else `400`). The **first** inbox call
    triggers `ensureAdapterReady`, which **lazily spawns** the master adapter and cold-starts
    `hermes acp` — so the first turn is slow (≈10 s observed).
  - **outbox**: `GET /instances/inst_0/outbox` is an SSE stream (`text/event-stream`). It first
    **replays** buffered frames (from `Last-Event-ID` or 0), then pushes live frames. Frame
    shape: `id: <n>\nevent: <turn|done|suspend|error|heartbeat>\ndata: <json>\n\n`. A heartbeat
    fires every `HEARTBEAT_INTERVAL_MS = 15000` ms and is itself `buffer.append`-ed (so it
    **consumes an id** in the same monotonic sequence as content frames). On `event: done` or
    `event: error` the server calls `res.end()` and closes the stream
    (`outbox.ts` L45–47 replay path, L78–80 live path).

## When
- An outbox SSE subscriber is opened first (unbuffered), then a single message is POSTed.
  Observed live:
  ```bash
  # 1) subscribe (background, -N = no curl buffering)
  curl -sN http://127.0.0.1:7912/instances/inst_0/outbox
  # stream opened at 23:58:46.838 (local, UTC+8)

  # 2) ~8.5 s later, submit one message
  curl -s -X POST http://127.0.0.1:7912/instances/inst_0/inbox \
       -H 'Content-Type: application/json' \
       -d '{"content":"Say exactly: pong"}'
  # POST at 23:58:55.3 ; HTTP 202 returned in time_total=0.099 s (async — accept, don't block)
  ```
- Because the outbox has a replay buffer, ordering of the two independent HTTP requests is not
  load-bearing: opening the stream before or after the POST both capture the full sequence
  (the replay path re-emits buffered frames). Here the stream was opened first.

## Then
- **`POST .../inbox` → `202`, `@sumeru/inbox-accepted`** (returns immediately; the agent runs
  asynchronously). Observed byte-exact body:
  ```json
  {"type":"@sumeru/inbox-accepted","value":{"instanceId":"inst_0","messageId":"msg_01KW7F93FCXY6S947J11K5QJDG"}}
  ```
  - `value.instanceId` echoes the target master; `value.messageId` is a freshly minted ULID-
    style id (`msg_…`). `time_total ≈ 0.099 s` — accept is decoupled from agent execution.

- **`GET .../outbox`** emitted the following **real** SSE frame sequence (verbatim, in order;
  stream then closed by the server). This is the live capture, not a reconstruction:
  ```text
  id: 1
  event: heartbeat
  data: {}

  id: 2
  event: turn
  data: {"type":"turn","value":{"index":0,"role":"assistant","content":"pong","timestamp":"2026-06-28T15:59:05.284Z","toolCalls":null,"tokens":null}}

  id: 3
  event: done
  data: {"type":"done","value":{"summary":null,"tokenUsage":null}}
  ```

- **Frame-by-frame:**
  - `id: 1` `event: heartbeat` `data: {}` — the **only** heartbeat seen. It appears here
    *because* the subscriber was opened ~18.4 s before the `turn` and the stream therefore
    crossed one 15 s heartbeat boundary while the adapter cold-started; the heartbeat was
    `buffer.append`-ed and so took id `1`. **This heartbeat is timing-dependent, not part of the
    logical roundtrip** — if the POST and turn complete within one 15 s window, the first frame
    is `turn` at `id: 1` and no heartbeat appears.
  - `id: 2` `event: turn` — the real agent reply. `value` is a `TurnFrame`
    `{ index, role, content, timestamp, toolCalls, tokens }`: `index: 0` (first turn),
    `role: "assistant"`, `content: "pong"` (the master agent obeyed “Say exactly: pong” exactly),
    `timestamp: "2026-06-28T15:59:05.284Z"` (adapter-side ISO), `toolCalls: null`,
    `tokens: null` (per-turn token stats not populated by adapter-hermes — see Gaps).
  - `id: 3` `event: done` — terminal frame. `value` is `{ summary: null, tokenUsage: null }`:
    the roundtrip completed cleanly with **no** rollup summary and **no** aggregate token usage
    reported (both `null` — see Gaps). Per `outbox.ts` L78–80 the server `res.end()`s on this
    frame; the `curl -N` subscriber exited `0`.

- **Timing (observed):** `POST inbox (23:58:55.3 local)` → `turn timestamp 23:59:05.284Z
  (= 23:58:55→23:59:05 local, UTC+8)` ≈ **10.0 s** end-to-end for the first roundtrip. This
  latency is dominated by the one-time lazy `hermes acp` cold start + a single model call;
  subsequent turns on the warm adapter are expected to be faster (not measured — this scenario
  runs exactly one roundtrip by design).

- **Stream-close invariant:** the SSE stream is half-duplex per agent turn-batch — the server
  closes (`res.end()`) on the `done` frame, so a client observing a roundtrip sees the stream
  terminate rather than stay open idling. Re-`GET`ting the outbox would **replay** the buffered
  `id:1..3` and immediately hit `done` again (replay path `res.end()`, `outbox.ts` L45–47);
  this replay was **not** exercised here (single-roundtrip discipline) and is noted from source.

- **Envelope/credential reality:** unlike S1 discovery (fully offline), this scenario genuinely
  spawns the master adapter and reaches the configured model — it is the **first v2 path that
  depends on a live adapter binary and on valid `~/.hermes/config.yaml` credentials**. The green
  capture above was obtained with those preconditions satisfied.
