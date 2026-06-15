---
id: server-config
title: "Server Configuration"
sources:
  - packages/server/src/config.ts
  - packages/server/src/start.ts
  - packages/server/src/types.ts
tags: [architecture, server, configuration]
created: 2026-06-15
updated: 2026-06-15
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
    capabilities:              # required
      resume: true             # required boolean
      streaming: false         # required boolean
  claude:
    adapter: claude-code
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
| `gateways[key].capabilities` | required mapping |
| `capabilities.resume` | required boolean (not truthy — strict `typeof === "boolean"`) |
| `capabilities.streaming` | required boolean |

Unknown keys at any level are silently tolerated for forward-compatibility.

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
