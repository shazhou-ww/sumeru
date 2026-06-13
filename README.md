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
```

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
| `@sumeru/cli` | CLI tool (`sumeru run`, `sumeru list`) |

## Name

From the Buddhist concept 芥子须弥 (sarṣapa-sumeru):
a mustard seed that contains Mount Sumeru.
A small container that holds a complete world —
just like a Docker container holding a full agent environment.

## License

MIT
