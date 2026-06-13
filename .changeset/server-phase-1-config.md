---
"@sumeru/server": minor
"@sumeru/cli": minor
---

Phase 1: configuration loading + read-only gateway endpoints.

- New `loadConfig(path)` in `@sumeru/server` parses `sumeru.yaml` into a typed
  `InstanceConfig` (`name`, `gateways: Record<string, GatewayConfig>`).
- `@sumeru/server` now takes `gateways` in `StartConfig` / `ServerConfig`.
- `GET /` returns `@sumeru/instance` with `value.name` from the YAML and
  `value.gateways` as an ordered array of gateway names.
- New `GET /gateways` endpoint returns `@sumeru/gateway-list` envelope with
  every configured gateway (`name`, `adapter`, `status`, `activeSessions`,
  `capabilities`). Status is `"ready"` and `activeSessions` is `0` in Phase 1.
- New `GET /gateways/:name` endpoint returns `@sumeru/gateway` envelope, or a
  `404 @sumeru/error` envelope with `error: "gateway_not_found"` (distinct from
  the generic `not_found` for unknown paths).
- `POST` on `/gateways` and `/gateways/:name` returns `405 + Allow: GET` with a
  `@sumeru/error` envelope.
- `sumeru start` gains a `-c, --config <path>` option. Bad/missing config files
  cause a clear stderr message and exit non-zero before binding a port.
- All response bodies — including 404 and 405 — use the `{ type, value }` ocas
  envelope; no plain text or stack traces leak.
