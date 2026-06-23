---
"@sumeru/cli": patch
---

Docker Phase 3 (#86): gated integration suite + README.

Adds `packages/cli/tests/docker-mode.test.ts`, a `SUMERU_DOCKER_INTEGRATION`-gated
suite that drives the real Docker backend end-to-end (build / self-contained
image, start + health, SSE round-trip, ocas persistence across `down`,
multi-unit isolation, deterministic export, non-fatal gateway degradation,
no-Docker downgrade). The gate keeps CI green — with the env var unset the suite
skips and touches no Docker at import. A test-only `tests/helpers/docker.ts`
bundles the runners, health poll, deterministic fake-`hermes` seam (no LLM /
creds / network), and a built-in tar/gzip export decoder.

README's 部署 chapter's 「Docker 模式」 subsection is corrected — the stale Phase 1
"统一入口在后续阶段接入" note is replaced with the shipped `sumeru start -c <config>`
launch path plus the two operator guarantees (named-volume persistence; one
config = one isolated work unit).

The gateway-degradation case asserts the real contract — `GET /gateways` status
is keyed on adapter-name registration, not a runtime binary probe, so a bundled
`claude-code` with no `claude` binary stays `ready` while an unknown adapter is
`unavailable` — documented in `specs/integration/docker-gateway-status-semantics.md`,
with the aspirational binary-probe enhancement tracked in #93.

Test + docs only; no shipped behavior change.
