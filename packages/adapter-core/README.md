# @sumeru/adapter-core — Adapter framework and NDJSON protocol

## What it does

Common framework for Sumeru agent adapters. Implements the stdin/stdout **NDJSON protocol**: the Host sends `init` and `message` frames on stdin; the adapter writes `ready`, `turn`, `done`, `suspend`, or `error` frames on stdout. Each line is one JSON object.

Adapter authors implement `AdapterImpl` (`init` + async-generator `handle`); `createAdapterEntry` wires that impl to process stdio for container entrypoints.

## API / Exports

**Runtime**

- `createAdapterEntry(impl)` — bind `AdapterImpl` to process stdio; exits on EOF/SIGTERM
- `runAdapterEntry(options)` — same loop with injectable stdin/stdout (for tests)

**Contract types**

- `AdapterImpl`, `AdapterInitConfig`, `AdapterInboxMessage`, `AdapterHandleYield`
- `AdapterManifest`, `ProviderMode`, `BuiltinModel`, `ListModelsFn`

**Wire frames**

- Inbound: `InboundFrame`
- Outbound: `OutboundFrame`, `TurnValue`, `DoneValue`, `SuspendValue`, `WireErrorValue`

## Usage example

```typescript
import { createAdapterEntry } from "@sumeru/adapter-core";
import { createMyAdapter } from "./adapter.js";

createAdapterEntry(createMyAdapter());
```

NDJSON inbound: `{ "type": "init", "value": { instructions, skills, model } }`, then `{ "type": "message", "value": { messageId, content, project } }`.

Workspace dependency: `"@sumeru/adapter-core": "workspace:*"`. Version **0.3.0**.
