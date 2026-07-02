# @sumeru/host — HTTP host service and transport layer

## What it does

The Sumeru **Host** — an HTTP server that manages agent lifecycle: prototypes, sessions, SQLite-backed registry (providers, models, personas, skills), and Docker-based adapter transport. Bundles all built-in adapters and exposes a REST API consumed by `@sumeru/cli`.

Configuration is loaded from a root directory (`host.yaml`, `prototypes/`, SQLite DB). Sessions run adapter containers (or mock transport in tests) and record turns via ocas.

## API / Exports

**Server**

- `startHost(config)`, `createHostHandler(...)`, `VERSION`
- `createRouter`, `createSessionManager`
- `loadHostConfig`, `resolveSessionModel`, `mergeSessionEnv`, …

**Transport**

- `createDockerTransport`, `createMockTransport`, `defaultAdapterCommand`

**Types**

- `Transport`, `ManagedSession`, `HostServerOptions`, `Envelope`, …

**Subpath:** `@sumeru/host/sqlite` — SQLite store helpers.

**Binary:** `sumeru-host <rootDir>`.

## Key HTTP endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Host status |
| PUT | `/providers/:name`, `/personas/:name`, `/prototypes/:name`, `/extensions/:name`, `/skills/:name` | Upsert pattern |
| PUT | `/providers/:name/models/:modelName` | Upsert model |
| POST | `/sessions` | Create session |
| POST | `/sessions/:id/messages` | Send message |
| GET | `/sessions/:id/events` | SSE event stream |
| GET | `/search` | Full-text search |

## Usage example

```bash
SUMERU_HOST=127.0.0.1 SUMERU_PORT=7900 sumeru-host ./my-sumeru
```

```typescript
import { startHost, createDockerTransport } from "@sumeru/host";

const host = await startHost({ rootDir: "./my-sumeru" });
```

Version **0.3.0**.
