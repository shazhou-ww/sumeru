# Sumeru 🏔️

> 芥子纳须弥 — A mustard seed contains Mount Sumeru

Agent behavior observation lab. Run scenes, record turns, analyze UX.

## Concept

**Sumeru** creates isolated environments (scenes), places an agent inside,
and records its complete behavior — every turn, every tool call, every output.
The recording is then available for developers to analyze how agents interact
with their tools.

```
Scene (what)         →  Runner (how)           →  Recording (what happened)
─────────────           ──────────────             ─────────────────────────
tools, fixtures         agent type + model         full turns with tool calls
task prompt             timeout, network           stored in ocas → exportable
knowledge (skills)      docker isolation
```

### Design Principles

- **Agent-agnostic** — Scenes don't assume Hermes, Claude Code, or any specific agent
- **Full isolation** — Each run in a fresh Docker container
- **Full fidelity** — Record every turn untruncated, reconstruct all side effects from tool calls
- **Separation of concerns** — Scene defines the world, Runner executes, Judge evaluates (separately)

## Usage

```bash
# Run a scene
sumeru run -s scenes/first-uwf-usage -r hermes -m claude-sonnet-4

# List available scenes
sumeru list

# Start the HTTP service (with optional config)
sumeru start --port 7900 --config sumeru.yaml
```

## HTTP Service

`sumeru start` runs an HTTP service whose responses use the ocas envelope
shape `{ type, value }`. With a `sumeru.yaml` config, the service exposes:

| Method | Path                | Envelope                  |
|--------|---------------------|---------------------------|
| GET    | `/`                 | `@sumeru/instance`        |
| GET    | `/gateways`         | `@sumeru/gateway-list`    |
| GET    | `/gateways/:name`   | `@sumeru/gateway`         |

Unknown paths return a 404 `@sumeru/error` envelope; an unknown gateway name
returns a 404 with `error: "gateway_not_found"`. Disallowed methods return
405 with `Allow: GET`.

### sumeru.yaml

```yaml
name: sumeru@neko

gateways:
  hermes:
    adapter: hermes
    capabilities:
      resume: true
      streaming: true

  claude-code:
    adapter: claude-code
    capabilities:
      resume: true
      streaming: false
```

Without `--config`, the service falls back to `name: "sumeru"` and an empty
gateway list. A bad or missing config file causes `sumeru start` to print
to stderr and exit non-zero before binding a port.

## Scene Structure

```
scenes/first-uwf-usage/
  scene.yaml              # Scene definition
  home/                   # Mounted as $HOME in container
    repos/
      sample-project/
        package.json
        src/
```

### scene.yaml

```yaml
name: first-uwf-usage
description: New user's first time with uwf

tools:
  - uwf
  - git
  - node

knowledge:
  skills: []
  memory: []

task: |
  You are a developer. Use uwf to create
  a code-review workflow and run it.
```

## Recording Format

Recordings capture the full conversation as structured turns:

```json
{
  "meta": {
    "scene": "first-uwf-usage",
    "runner": "hermes",
    "model": "claude-sonnet-4",
    "durationMs": 183000,
    "exit": "completed",
    "turnCount": 24
  },
  "turns": [
    {
      "index": 0,
      "role": "user",
      "content": "...",
      "timestamp": "2026-06-13T12:00:00Z"
    },
    {
      "index": 1,
      "role": "assistant",
      "content": "Let me explore...",
      "toolCalls": [
        {
          "tool": "terminal",
          "input": { "command": "uwf --help" },
          "output": "Usage: uwf <command>...",
          "durationMs": 300
        }
      ]
    }
  ]
}
```

## Packages

| Package | Description |
|---------|-------------|
| `@sumeru/core` | Type definitions (Scene, Turn, Recording) |
| `@sumeru/server` | HTTP service (instance endpoint, gateways, sessions) |
| `@sumeru/cli` | CLI tool (`sumeru run`, `sumeru list`, `sumeru start`) |

## Name

From the Buddhist concept 芥子须弥 (sarṣapa-sumeru):
a mustard seed that contains Mount Sumeru.
A small container that holds a complete world —
just like a Docker container holding a full agent environment.

## License

MIT
