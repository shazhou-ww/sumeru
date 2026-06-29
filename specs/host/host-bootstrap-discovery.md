---
scenario: "A from-scratch minimal v2 tree (host.yaml + one prototype dir) boots @sumeru/host, which implicitly seeds the reserved master inst_0 via local transport (no Docker, no adapter spawn) and serves the read-only discovery surface — GET / , /prototypes , /prototypes/:name , /instances , /instances/:id/status — as typed @sumeru/* envelopes with inst_0 present and the scanned prototype listed"
feature: host-bootstrap-discovery
tags: [host, bootstrap, discovery, master, inst_0, manifest, envelope, http, m1, examples-minimal, s1]
---

## Given
- The repo is built (`pnpm install && pnpm run build`) so `packages/host/dist/main.js`
  and the workspace `@sumeru/*` packages exist. Host entry: `node packages/host/dist/main.js [rootDir]`
  (`packages/host/src/main.ts`); `rootDir` defaults to `cwd`; env `SUMERU_HOST` (default
  `127.0.0.1`), `SUMERU_PORT` (default `7900`).
- A minimal v2 config tree exists at `examples/minimal/` (the repo root `sumeru.yaml` is
  **v1 legacy** with `gateways:` and is NOT a v2 `host.yaml`). Loaded by
  `loadHostConfig(rootDir)` in `packages/host/src/config.ts`:
  - `examples/minimal/host.yaml` — `HostConfig` validated by `validateHostConfig`:
    - `name: minimal-host` (required non-empty string),
    - `master: { adapter: "hermes", config: { command, instructions, model } }` —
      `master.adapter` required non-empty string; `master.config` is an opaque
      `Record<string, unknown>`. `command: ["node","packages/adapter-hermes/dist/main.js"]`
      is the explicit master adapter command (precedence in `resolveMasterAdapterCommand`:
      `config.command` > `config.binary` > fallback `node <rootDir>/packages/adapter-hermes/dist/main.js`).
    - `resources: { maxMemory: "2g", maxCpus: 2, maxInstances: 4 }` — `maxMemory` non-empty
      string, `maxCpus`/`maxInstances` finite numbers (all required).
    - `dataDir` omitted → defaults to `<rootDir>/data`.
  - `examples/minimal/prototypes/echo-worker/manifest.yaml` — `Manifest` validated by
    `validateManifest`: `name: echo-worker` (non-empty), `instructions` (string),
    `skills: []` (optional string array), `model: { provider: anthropic, name: claude-sonnet-4,
    apiKey: ${ANTHROPIC_API_KEY}, contextWindow: 200000 }` validated by `validateModelConfig`.
  - `examples/minimal/prototypes/echo-worker/compose.yaml` — present but NOT schema-validated
    (opaque; only forwarded to `docker compose` for *worker* creation, never read during
    discovery).
- The prototype map key is the **directory name** (`echo-worker`), and `adapter` is derived
  from `manifest.name` (falls back to the dir name if empty) — `resolveAdapterName` in `config.ts`.
- Boot is offline: `startHost` → `manager.bootMaster()` only calls `transport.up()` for the
  master project, which (local transport) returns `{ containerId: "master" }` and sets status
  `running`. **No master adapter process is spawned at boot** and **no Docker daemon is
  contacted** — the adapter is spawned lazily on the first inbox (`ensureMasterAdapterReady`),
  so discovery does not depend on a valid adapter binary or on `~/.hermes/config.yaml`.

## When
- The host is started from the **repo root** with the example dir as `rootDir`:
  ```bash
  SUMERU_PORT=7911 node packages/host/dist/main.js examples/minimal
  ```
  (`process.argv[2]` = `examples/minimal`). The server binds and the master is seeded before
  the first request is served.
- The client issues the read-only discovery requests (verbatim, observed live):
  ```bash
  curl -s http://127.0.0.1:7911/
  curl -s http://127.0.0.1:7911/prototypes
  curl -s http://127.0.0.1:7911/prototypes/echo-worker
  curl -s http://127.0.0.1:7911/instances
  curl -s http://127.0.0.1:7911/instances/inst_0/status
  ```

## Then
- Every JSON response is a typed envelope `{ "type": "@sumeru/<name>", "value": ... }`, served
  with `Content-Type: application/json; charset=utf-8` and an explicit `Content-Length`
  (`writeJson` in `packages/host/src/http-utils.ts`).

- **`GET /` → `200`, `@sumeru/host`** (host identity). Observed byte-exact body:
  ```json
  {"type":"@sumeru/host","value":{"name":"minimal-host","version":"0.1.0","master":"inst_0","prototypes":["echo-worker"],"instances":["inst_0"]}}
  ```
  - `value.name` echoes `host.yaml` `name`; `value.version` is the hardcoded host `VERSION`
    (`"0.1.0"`); `value.master` is the reserved `"inst_0"`; `value.prototypes` is the array of
    scanned prototype **directory names**; `value.instances` is every live instance id (master
    included). The shape is `HostRootValue` `{ name, version, master, prototypes, instances }`.

- **`GET /prototypes` → `200`, `@sumeru/prototype-list`**. Observed:
  ```json
  {"type":"@sumeru/prototype-list","value":[{"name":"echo-worker","adapter":"echo-worker"}]}
  ```
  - `value` is a `{ name, adapter }[]` summary — manifest payloads are NOT included here.

- **`GET /prototypes/echo-worker` → `200`, `@sumeru/prototype`** (single prototype + full
  manifest). Observed:
  ```json
  {"type":"@sumeru/prototype","value":{"name":"echo-worker","adapter":"echo-worker","manifest":{"name":"echo-worker","instructions":"You are a minimal echo worker. Repeat the user's message back to them.\n","skills":[],"model":{"provider":"anthropic","name":"claude-sonnet-4","apiKey":"${ANTHROPIC_API_KEY}","contextWindow":200000}}}}
  ```
  - `value.manifest` is the parsed-and-validated `Manifest` (note the trailing `\n` preserved
    from the YAML block scalar `instructions`). An unknown name → `404 @sumeru/error`
    `{ "error":"prototype_not_found" }`.

- **`GET /instances` → `200`, `@sumeru/instance-list`**. Observed (`createdAt` is a runtime
  ISO timestamp; rest is stable):
  ```json
  {"type":"@sumeru/instance-list","value":[{"id":"inst_0","prototype":null,"status":"running","createdAt":"2026-06-28T15:40:58.411Z","projects":[]}]}
  ```
  - The reserved master is in the list with `id:"inst_0"`, `prototype:null` (master marker),
    `status:"running"`, `projects:[]`. Each element is an `InstanceInfo`
    `{ id, prototype, status, createdAt, projects }` — runtime internals (`containerId`,
    `projectName`, `composePath`, `initVersion`) are NOT exposed here.

- **`GET /instances/inst_0/status` → `200`, `@sumeru/instance-status`**. Observed:
  ```json
  {"type":"@sumeru/instance-status","value":{"id":"inst_0","status":"running","containerId":"master"}}
  ```
  - `value.containerId` is the local master handle `"master"` (`LOCAL_MASTER_HANDLE`),
    confirming the master ran through local transport, not Docker. Shape is
    `InstanceStatusValue` `{ id, status, containerId }`.

- **Router invariants** (observed, same `createHostHandler` route table):
  - `GET /instances/inst_999/status` (unknown id) → `404 @sumeru/error`
    `{ "error":"instance_not_found", "message":"Instance inst_999 not found" }`.
  - `GET /instances/inst_0` (no such route — only `DELETE` is registered for `/instances/:id`)
    → `405 @sumeru/error` `{ "error":"method_not_allowed", ... }` with header `Allow: DELETE`.
  - `POST /` → `405 @sumeru/error` `{ "error":"method_not_allowed", ... }` with `Allow: GET`.
  - `GET /nope` → `404 @sumeru/error` `{ "error":"route_not_found", "message":"No route for GET /nope" }`.
  - `HEAD /` is auto-handled as `GET` (`200`, same headers, empty body).

- **Side effects of boot:** `<rootDir>/data/` (`examples/minimal/data/`) is created eagerly at
  manager construction (`createOcasRecorder` → `mkdirSync(dataDir, {recursive:true})`), even
  before any inbox traffic; it is empty after discovery-only use and is gitignored.

- Discovery is fully offline: no Docker daemon, no spawned adapter, and no model credentials
  are required to reach green on any of the five endpoints above.
