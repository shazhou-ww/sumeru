# @sumeru/sumeru-session — Unified adapter session entrypoint

## What it does

Provides the shared session runtime that all Sumeru adapters use inside their containers. Handles:

- **CLI auto-detection** — detects which agent CLI is available (`claude`, `codex`, `cursor-agent`, `hermes`) and selects the matching harness
- **NDJSON stdin/stdout protocol** — reads `init` and `message` frames from Host, emits `turn`, `done`, `suspend`, `error` frames
- **Control frames** — processes `model`, `reset`, `install-skill` commands from Host
- **Harness abstraction** — each adapter provides a harness that translates between the unified protocol and the specific agent CLI's I/O format

## API / Exports

```typescript
import { detectAdapter, isCommandAvailable } from "@sumeru/sumeru-session";
```

| Export | Description |
|--------|-------------|
| `detectAdapter()` | Scans PATH for known agent CLIs, returns `DetectedAdapter` |
| `isCommandAvailable(cmd)` | Checks if a command exists on PATH |
| `DetectedAdapter` | Type: `{ name: string; command: string }` |

**Entrypoint binary:** Used as the adapter process inside Docker containers. Not invoked directly by users.

## Architecture

```
Host (docker exec) → stdin → sumeru-session entrypoint
                                    ↓
                              detect adapter
                                    ↓
                         load harness (hermes/claude-code/codex/sarsapa/cursor)
                                    ↓
                         harness.init(config) → spawn agent CLI
                                    ↓
                         harness.message(content) → relay to agent
                                    ↓
                         parse agent stdout → emit turn/done frames → stdout → Host
```

## Usage

Not used directly. The Host's Docker transport runs:

```bash
docker exec <container> node /app/packages/sumeru-session/dist/entrypoint.js
```

The entrypoint auto-detects the adapter and starts processing frames.

Version **0.1.0**.
