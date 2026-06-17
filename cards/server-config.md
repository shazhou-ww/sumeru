---
id: server-config
title: "Server Configuration"
sources:
  - packages/server/src/config.ts
  - packages/server/src/start.ts
  - packages/server/src/types.ts
  - packages/cli/src/build-adapters.ts
  - README.md
tags: [architecture, server, configuration]
created: 2026-06-15
updated: 2026-06-17
---

# Server Configuration

`@sumeru/server` loads its configuration from a `sumeru.yaml` file. The config layer handles YAML parsing, structural validation, and default resolution before the HTTP listener starts.

## sumeru.yaml Schema

```yaml
name: my-instance              # required, non-empty string
workspaceRoot: /path/to/root   # optional, null if absent/empty
gateways:                      # optional mapping (empty = no gateways)
  hermes:
    adapter: hermes            # required, non-empty string
    config:                    # optional, adapter-specific options
      timeout: 3600            # forwarded verbatim to adapter factory
    capabilities:              # required
      resume: true             # required boolean
      streaming: false         # required boolean
  claude-code:
    adapter: claude-code
    config:
      sendTimeoutMs: 3600000   # 1 h (default 30 min)
      maxTurns: 120            # default 90
    capabilities:
      resume: false
      streaming: true
```

## Type Definitions

### InstanceConfig

The validated output of `loadConfig()`:

```typescript
type InstanceConfig = {
  name: string;
  workspaceRoot: string | null;
  gateways: Record<string, GatewayConfig>;
};
```

### GatewayConfig

Each gateway entry within the config:

```typescript
type GatewayConfig = {
  adapter: string;                    // adapter name to look up at runtime
  capabilities: GatewayCapabilities;
  config: Record<string, unknown> | null;  // adapter-specific options
};

type GatewayCapabilities = {
  resume: boolean;
  streaming: boolean;
};
```

### ServerConfig

The runtime configuration passed to `createHandler()` — combines the parsed YAML with runtime state:

```typescript
type ServerConfig = {
  name: string;
  version: string;
  gateways: Record<string, GatewayConfig>;
  workspaceRoot: string | null;
  adapters: Record<string, Adapter>;   // keyed by adapter name
  sseHeartbeatMs: number;              // default 15_000
  sseBufferSize: number;               // default 1024
  sseRetentionMs: number;              // default 30_000
  ocas: OcasConfig;
};
```

### StartConfig

The external-facing config for `startServer()` — allows nullable fields with defaults:

```typescript
type StartConfig = {
  port: number;
  host: string;
  name: string;
  version: string;
  gateways: Record<string, GatewayConfig>;
  workspaceRoot: string | null;
  adapters: Record<string, Adapter> | null;   // null → {} (all unavailable)
  sseHeartbeatMs: number | null;              // null → 15_000
  sseBufferSize: number | null;               // null → 1024
  sseRetentionMs: number | null;              // null → 30_000
  ocasDir: string | null;                     // null → env/default resolution
};
```

## Config Loading (`loadConfig`)

```
loadConfig(path) → Promise<InstanceConfig>
```

Three-phase pipeline:
1. **Read** — `readFile(path, "utf-8")` with ENOENT → descriptive error
2. **Parse** — `yaml.parse()` with catch → descriptive error
3. **Validate** — structural checks with field-level error messages

### Validation Rules

| Field | Rule |
|-------|------|
| top-level | must be a YAML mapping (non-null object, non-array) |
| `name` | required, non-empty string |
| `workspaceRoot` | optional; absent/null/empty string → `null`; non-string → error |
| `gateways` | optional mapping; absent/null → empty `{}`; non-object → error |
| `gateways[key].adapter` | required, non-empty string |
| `gateways[key].config` | optional mapping; absent/null → `null`; non-mapping → error; contents **not validated** |
| `gateways[key].capabilities` | required mapping |
| `capabilities.resume` | required boolean (not truthy — strict `typeof === "boolean"`) |
| `capabilities.streaming` | required boolean |

Unknown keys at any level are silently tolerated for forward-compatibility.

### Gateway Config Forwarding (Issue #32)

Each gateway's `config:` block is an **opaque adapter-specific blob** that the server does NOT validate:

- **At config load time**: `loadConfig()` accepts any mapping (object), rejects scalars/arrays/etc.
- **At adapter factory time**: The CLI's `buildAdapters()` forwards `gw.config ?? {}` verbatim to the adapter factory (e.g. `createHermesAdapter(opts)`, `createClaudeCodeAdapter(opts)`)
- **Adapter validates its own keys**: Each adapter is responsible for validating its own option schema and throwing on unknown/invalid keys

Example: claude-code adapter's configurable timeouts and limits:

```yaml
gateways:
  claude-code:
    adapter: claude-code
    config:
      sendTimeoutMs: 3600000          # 1 h (default 30 min)
      createSessionTimeoutMs: 300000  # 5 min (default 5 min)
      maxTurns: 120                   # default 90
    capabilities:
      resume: true
      streaming: true
```

Omit `config:` entirely (or set to `null` / `{}`) to use adapter's built-in defaults. Unknown keys are passed through to the adapter but silently ignored if the adapter doesn't recognize them.

## workspaceRoot

When set, per-session `config.cwd` values are resolved relative to this path and confined within it (see session CWD resolution). The config layer only validates the type — path resolution happens at session-creation time.

Folding rules:
- absent / `undefined` / `null` → `null`
- empty string `""` → `null` (operator did not configure)
- non-empty string → stored verbatim (no path resolution at config layer)

## Ocas Directory Resolution

`resolveOcasDir(explicit)` determines the CAS store location:

```
Priority: explicit arg  >  $SUMERU_OCAS_DIR env  >  ~/.sumeru/ocas
```

- `~/` prefix is expanded via `os.homedir()`
- Result is always an absolute path (`path.resolve`)

## Server Startup (`startServer`)

```
startServer(config: StartConfig) → Promise<StartedServer>
```

Sequence:
1. Resolve ocas directory and open the CAS store (`openSumeruOcas`)
2. Build the request handler via `createHandler` with defaults applied:
   - `adapters`: `config.adapters ?? {}`
   - `sseHeartbeatMs`: `config.sseHeartbeatMs ?? 15_000`
   - `sseBufferSize`: `config.sseBufferSize ?? 1024`
   - `sseRetentionMs`: `config.sseRetentionMs ?? 30_000`
3. Create a Node.js HTTP server
4. Listen on `host:port` (port 0 → OS picks a free port)
5. Return `{ host, port, stop() }` on success

### Error Handling

- Ocas filesystem errors (EACCES, ENOSPC, EROFS) reject the promise — HTTP listener is never started
- Listen errors (EADDRINUSE, etc.) reject the promise
- The returned `stop()` function gracefully closes the server

### StartedServer

```typescript
type StartedServer = {
  port: number;    // actual bound port (useful when config.port was 0)
  host: string;
  stop: () => Promise<void>;
};
```
