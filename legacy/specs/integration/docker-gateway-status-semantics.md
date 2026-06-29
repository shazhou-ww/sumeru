---
scenario: "GET /gateways `status` is derived from adapter-name registration, not from a runtime agent-binary probe — so a bundled adapter whose CLI binary is absent from the image still reports `ready`, and only an unknown adapter name reports `unavailable`"
feature: server-gateway-status
tags: [server, gateway, status, docker, degradation, issue-86, phase-3]
---

## Context

Phase 3 (`specs/integration/docker-mode-integration.md`, issue #86) set out to
lock a "missing agent binary degrades that gateway only" behavior (its Then-7,
echoing `specs/architecture/docker-mode.md`'s table row "缺哪个 adapter，对应
gateway 启动后报 `status: \"unavailable\"`"). Standing the real Docker
integration up against the shipped server revealed that wording describes a
behavior the codebase **does not implement** — there is no runtime binary probe
anywhere on the gateway-list path. This spec records the **real** contract so
the Phase-3 suite asserts what the system actually guarantees, and flags the gap
for a future product decision.

## The real contract (what the code does today)

- `GET /gateways` builds each entry's `status` in `packages/server/src/handler.ts`
  (`buildGateway`): `status = adapters[cfg.adapter] !== undefined ? "ready" : "unavailable"`.
  The sole input is **whether an adapter instance is registered under that
  gateway's `adapter` name** — never a filesystem / `$PATH` / `--version` probe
  of the underlying agent CLI.
- The registry is assembled in `packages/cli/src/build-adapters.ts` (`buildAdapters`):
  it walks `gateways` and, for each, looks up `DEFAULT_ADAPTER_FACTORIES[gw.adapter]`.
  The bundled names are `hermes`, `claude-code`, `codex`, `cursor-agent` (all
  statically imported, so all always present in a normal CLI install). An
  **unknown** adapter name has no factory → the slot is left empty → that
  gateway reports `unavailable`. A known name always yields an adapter instance
  → `ready`.
- Adapter construction is pure — e.g. `createClaudeCodeAdapter(opts)` just builds
  a closure. The agent binary (`claude`, `hermes`, …) is resolved **lazily**, at
  `createSession` / `send` time, via `spawn`. A missing binary therefore surfaces
  as a per-session runtime error (or an SSE `error` event), **not** as a
  gateway-list status, and never at boot.
- Authority: `specs/cli/cli-pass-gateway-config.md` ("Then" → "**Unknown adapter
  type → unavailable**": a gateway whose `adapter:` is not one of the known names
  is "silently omitted from the adapters map, and `GET /gateways` reports it as
  `status: \"unavailable\"`"). No clause there predicates `unavailable` on a
  binary probe.

### Consequences asserted by the Phase-3 suite (Then-7)

Given `degraded.yaml` declaring three gateways in a container whose image ships
**no** `claude` binary:

- `hermes` (bundled adapter, fake-hermes bin bind-mounted) → `status: "ready"`,
  and a `POST /gateways/hermes/sessions` on it succeeds (the healthy gateway is
  unaffected by its neighbors).
- `claude-code` (bundled adapter, **no** `claude` binary in the image) →
  `status: "ready"`. The missing binary does **not** flip the list status; it
  would only manifest if a session were actually created/sent on that gateway.
- `bogus` (unknown adapter name) → `status: "unavailable"` — the genuine
  degraded entry the list reports.
- The instance boots healthy (`GET /` 200) regardless; one `unavailable` gateway
  never drags down the others or the instance (the non-fatal-degradation
  guarantee from `docker-mode.md` Then-2, which DOES hold — just keyed on
  registration, not on a binary probe).

## The gap (aspirational wording, not yet built)

`docker-mode.md` and the original Phase-3 Then-7 imply a richer "agent binary
present?" probe feeding the gateway-list status (so an operator sees at a glance
that `claude-code` is configured but unusable because `claude` isn't installed).
That is a **product enhancement**, not a Phase-3 test concern, and is explicitly
out of Phase 3's "test + docs only, no `src/` change" scope. It would require,
at minimum:

- a per-adapter `probe()` capability (e.g. `claude --version` / `which claude`),
  invoked when assembling the gateway list (with caching + a timeout so a hung
  binary can't stall `GET /gateways`), and
- a richer status enum (e.g. `ready` / `binary-missing` / `unavailable`) so
  "registered but unrunnable" is distinguishable from "unknown adapter".

Tracked separately (issue #93 against `sumeru`); Phase 3 deliberately does not
implement it. If/when that lands, this spec and the suite's Then-7 update to the
probe-aware contract.

## Non-goals

- No change to `handler.ts` / `build-adapters.ts` status logic in Phase 3.
- No new status enum value in Phase 3.
- No binary probing on the `GET /gateways` path in Phase 3.
