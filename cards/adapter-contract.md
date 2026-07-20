---
id: adapter-contract
title: "Adapter Protocol: sumeru-adapter Subcommand Interface"
sources:
  - packages/adapter-core/src/subcommand.ts
  - packages/adapter-core/src/types.ts
  - packages/adapter-core/src/harness-types.ts
tags: [sumeru, adapter, protocol]
created: 2026-06-28
updated: 2026-07-20
---

# Adapter Protocol: `sumeru-adapter` Subcommand Interface

> Every Sumeru adapter exposes a single binary `sumeru-adapter` with subcommands.
> Each subcommand runs as an independent process, executes its task, and exits.
> No persistent process, no framing protocol — just CLI semantics.

## TL;DR

A Sumeru **Prototype** = a Docker image where `sumeru-adapter` is on PATH and implements this protocol.

```bash
sumeru-adapter info                        # self-describe capabilities
sumeru-adapter config < config.json        # write model/persona/skills config
sumeru-adapter reset                       # clear session state
sumeru-adapter message < message.json      # process a message, stream turns
sumeru-adapter turns                       # read session history
sumeru-adapter install-skill --from /path  # install a skill from directory
sumeru-adapter uninstall-skill <name>      # remove a skill
sumeru-adapter list-models                 # list built-in platform models
```

## Subcommand Reference

### `info`

Output the adapter's static manifest. No stdin. Exits immediately.

**stdout:** JSON object
```json
{
  "name": "my-adapter",
  "providerMode": "custom-only",
  "credentialEnv": null,
  "listModels": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Adapter identifier |
| `providerMode` | `"custom-only"` \| `"both"` \| `"builtin-only"` | How LLM access is obtained |
| `credentialEnv` | string \| null | Env var carrying platform credential |
| `listModels` | `true` \| null | Whether `list-models` subcommand is supported |

**Exit code:** 0

---

### `config`

Write model, persona, and skills configuration. Idempotent — repeated calls overwrite.

**stdin:** One line of JSON (`AdapterInitConfig`):
```json
{
  "instructions": "You are a helpful assistant.",
  "skills": [{"name": "tdd", "content": "# TDD\n..."}],
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4",
    "apiKey": "sk-..."
  }
}
```

The `model` field is a `ModelConfig` — either:
- Known provider: `{ "provider": "anthropic" | "openai" | "openrouter", "name": "model-id", "apiKey": "..." }`
- Custom provider: `{ "provider": { "name": "bridge", "endpoint": "http://...", "apiType": "openai" | "anthropic" }, "name": "model-id", "apiKey": "..." }`

**stdout:** `{"ok": true}`

**Exit codes:** 0 = success, 1 = error, 2 = invalid input

---

### `reset`

Clear session state (conversation history, temporary files). Does NOT clear configuration (model, persona, skills).

Each adapter defines what "reset" means for its agent:

| Adapter | What gets cleared |
|---------|-------------------|
| hermes | `~/.hermes/sessions/` |
| claude-code | `~/.claude/projects/` |
| cursor-agent | `~/.cursor/sessions/` |
| codex | `~/.codex/sessions/` |
| sarsapa | internal session JSONL |

**stdin:** none  
**stdout:** `{"ok": true}`  
**Exit codes:** 0 = success, 1 = error

---

### `message`

Process a user message. The adapter resumes session context (if any), processes the message, and streams turn output as NDJSON.

**stdin:** One line of JSON (`InboxMessage`):
```json
{
  "messageId": "msg_01ABC...",
  "content": "Hello, what is 2+2?",
  "project": "/workspace"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | string | Unique message ID |
| `content` | string | User message text |
| `project` | string \| null | Working directory inside container (null = no project) |

**stdout:** NDJSON — one frame per line, streamed in real-time:
```
{"type":"turn","value":{"index":0,"role":"assistant","content":"2+2 = 4","timestamp":"...","toolCalls":null,"tokens":null,"durationMs":1234}}
{"type":"done","value":{"summary":"Answered math question","tokenUsage":{"input":10,"output":5,"cached":0}}}
```

Possible terminal frames:
- `{"type":"done","value":{...}}` — completed successfully
- `{"type":"suspend","value":{"reason":"timeout","elapsedMs":7200000,"nativeId":"..."}}` — timed out
- `{"type":"suspend","value":{"reason":"inputRequired","elapsedMs":...,"nativeId":"..."}}` — needs user input
- `{"type":"error","value":{"code":"handler_error","message":"..."}}` — adapter error

**Exit codes:** 0 = done, 1 = error, 2 = invalid input, 3 = suspend

**Resume semantics:** On startup, the adapter restores session context from its persistent storage (e.g., session JSONL) before processing the new message. Each invocation is a fresh process — context is loaded from disk, not from a persistent connection.

---

### `turns`

Read the current session's conversation history.

**stdin:** none  
**stdout:** NDJSON — one turn value per line:
```
{"index":0,"role":"user","content":"Hello","timestamp":"...","toolCalls":null,"tokens":null,"durationMs":null}
{"index":1,"role":"assistant","content":"Hi!","timestamp":"...","toolCalls":null,"tokens":null,"durationMs":500}
```

If no session exists or `getTurns` is not implemented, outputs `[]` (JSON array).

**Exit codes:** 0 = success, 1 = error

---

### `install-skill --from <path>`

Install a skill from a directory already present in the container (host uses `docker cp` to stage it first).

**Arguments:**
- `--from <path>` — absolute path to the skill directory inside the container

The skill name is parsed from `<path>/SKILL.md` frontmatter (`name:` field). Falls back to the directory basename.

**stdin:** none  
**stdout:** `{"ok": true}`  
**Exit codes:** 0 = success, 1 = error

---

### `uninstall-skill <name>`

Remove an installed skill by name.

**Arguments:** skill name (positional)

**stdin:** none  
**stdout:** `{"ok": true}`  
**Exit codes:** 0 = success, 1 = error

---

### `list-models`

List the adapter platform's available built-in models. Requires credentials to be configured via `config` or environment variable.

**stdin:** none  
**stdout:** JSON array:
```json
[
  {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "contextWindow": 200000},
  {"id": "claude-opus-4", "name": "Claude Opus 4", "contextWindow": 200000}
]
```

Returns `[]` for `custom-only` adapters or when `listModels` is not supported.

**Exit codes:** 0 = success, 1 = error

---

## Exit Code Convention

| Code | Meaning |
|------|---------|
| 0 | Success (done / ok) |
| 1 | Recoverable error (handler_error, init_error) |
| 2 | Protocol error (invalid JSON, missing fields) |
| 3 | Suspend (timeout / permissionRequest / inputRequired) — `message` only |

---

## Host Session Lifecycle

```
┌─────────────────────────────────────────────────────┐
│ sumeru session add <prototype> --task "..."          │
├─────────────────────────────────────────────────────┤
│ 1. docker create + start (from prototype image)     │
│ 2. docker exec sumeru-adapter config < {...}        │
│ 3. docker exec sumeru-adapter reset                 │
│ 4. docker exec sumeru-adapter message < {...}       │
│    └─ stream stdout → SSE subscribers               │
│ 5. container stopped after done/error               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ sumeru session send <id> "new message"              │
├─────────────────────────────────────────────────────┤
│ 1. docker start (if stopped)                        │
│ 2. docker exec sumeru-adapter config < {...}        │
│    (only if config changed since last init)         │
│ 3. docker exec sumeru-adapter message < {...}       │
│    └─ stream stdout → SSE subscribers               │
│ 4. container stopped after done/error               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ sumeru session snapshot <id> <name>                  │
├─────────────────────────────────────────────────────┤
│ 1. docker commit → sumeru/<name>:dev                │
│    (pure commit, no implicit reset)                 │
│ 2. Register as new prototype                        │
└─────────────────────────────────────────────────────┘
```

---

## Building a New Adapter

### 1. Implement `AdapterImpl`

```typescript
import type { AdapterImpl, AdapterInitConfig, AdapterInboxMessage, DoneValue, TurnValue } from "@sumeru/adapter-core";

export function createMyAdapter(): AdapterImpl {
  return {
    async init(config: AdapterInitConfig): Promise<void> {
      // Store config for later use (model, instructions, skills)
    },

    async *handle(message: AdapterInboxMessage): AsyncGenerator<TurnValue, DoneValue> {
      // Call your agent/LLM, yield turns as they arrive
      yield {
        index: 0,
        role: "assistant",
        content: "Response text",
        timestamp: new Date().toISOString(),
        toolCalls: null,
        tokens: null,
        durationMs: null,
      };
      return { summary: null, tokenUsage: null };
    },

    // Optional: restore session state on process start
    async resume(): Promise<boolean> {
      // Return true if session state was restored
      return false;
    },

    // Optional: expose native session ID for resume after suspend
    getNativeId(): string | null {
      return null;
    },

    // Optional: expose session turns for the `turns` subcommand
    getTurns(): TurnValue[] {
      return [];
    },
  };
}
```

### 2. Define `HarnessConfig`

```typescript
import type { HarnessConfig } from "@sumeru/adapter-core";
import { join } from "node:path";
import { homedir } from "node:os";

const myDir = join(homedir(), ".my-agent");

export const myHarness: HarnessConfig = {
  resetPaths: [join(myDir, "sessions")],           // Dirs to delete on reset
  modelConfigPath: join(myDir, "config.json"),      // Where to write model config
  personaPath: join(myDir, "PERSONA.md"),            // Where to write persona/instructions
  skillsDir: join(myDir, "skills"),                  // Where skills are installed
  writeModelConfig: null,                            // Custom model config writer (or null for default JSON)
  installSkill: null,                                // Custom skill installer (or null for default)
};
```

### 3. Define `AdapterManifest`

```typescript
import type { AdapterManifest } from "@sumeru/adapter-core";

export const manifest: AdapterManifest = {
  name: "my-adapter",
  providerMode: "custom-only",  // or "both" / "builtin-only"
  credentialEnv: null,           // e.g. "MY_API_KEY" for builtin-only/both
  listModels: null,              // or async (credential) => BuiltinModel[]
};
```

### 4. Wire up `main.ts`

```typescript
#!/usr/bin/env node
import { createSubcommandEntry } from "@sumeru/adapter-core";
import { createMyAdapter } from "./adapter.js";
import { myHarness } from "./harness.js";
import { manifest } from "./manifest.js";

createSubcommandEntry({
  impl: createMyAdapter(),
  harness: myHarness,
  manifest,
});
```

### 5. Dockerfile

```dockerfile
FROM sumeru/base:dev
COPY --chown=node:node packages/core/dist /home/node/adapter/core/dist
COPY --chown=node:node packages/core/package.json /home/node/adapter/core/package.json
COPY --chown=node:node packages/adapter-core/dist /home/node/adapter/adapter-core/dist
COPY --chown=node:node packages/adapter-core/package.json /home/node/adapter/adapter-core/package.json
COPY --chown=node:node packages/my-adapter/dist /home/node/adapter/my-adapter/dist
COPY --chown=node:node packages/my-adapter/package.json /home/node/adapter/my-adapter/package.json
RUN cd /home/node/adapter && mkdir -p node_modules/@sumeru \
    && ln -s /home/node/adapter/core node_modules/@sumeru/core \
    && ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core \
    && ln -s /home/node/adapter/my-adapter/dist/main.js /home/node/.local/bin/sumeru-adapter \
    && chmod +x /home/node/adapter/my-adapter/dist/main.js
USER node
WORKDIR /workspace
LABEL sumeru.harness="my-adapter"
CMD ["sleep", "infinity"]
```

### 6. Verify

```bash
# Build image
docker build -t sumeru/my-adapter:dev -f packages/my-adapter/Dockerfile .

# Test subcommands directly
docker run --rm sumeru/my-adapter:dev sumeru-adapter info
echo '{"instructions":"hi","skills":[],"model":{"provider":"anthropic","name":"test","apiKey":null}}' | \
  docker run --rm -i sumeru/my-adapter:dev sumeru-adapter config
docker run --rm sumeru/my-adapter:dev sumeru-adapter reset
echo '{"messageId":"m1","content":"hello","project":null}' | \
  docker run --rm -i sumeru/my-adapter:dev sumeru-adapter message

# Register as prototype and use
sumeru prototype add my-adapter --adapter my-adapter --model qwen3.7-max
sumeru session add my-adapter --task "hello"
```

---

## Legacy NDJSON Protocol (Deprecated)

When `sumeru-adapter` is called with **no subcommand**, it falls back to the legacy NDJSON stdin/stdout loop for backward compatibility. This mode is deprecated and will be removed in a future version.

---

## See Also

- [Architecture Overview](./architecture-overview.md)
- [Docker Image](./docker-image.md)
- [Instance Lifecycle](./instance-lifecycle.md)
- [Manifest Schema](./manifest-schema.md)
