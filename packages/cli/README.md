# @sumeru/cli — CLI client for the Sumeru Host API

## What it does

Command-line interface for managing a Sumeru instance. Wraps the Host HTTP API with typed commands, table formatting, and local helpers (`setup`, `server start/stop`). Built on `@ocas/cli-kit`.

Default Host address: `http://127.0.0.1:7900` (override with `--host` / `--port` or `SUMERU_HOST` / `SUMERU_PORT`).

## API / Exports

Library surface (for programmatic use):

- `createHostClient(options)` — typed HTTP client for all Host endpoints
- `formatTable`, `formatHostStatus`, `TableColumn`

**Binary:** `sumeru`.

## Command tree

```
sumeru setup --provider <name> --api-key <key> --model <model>
sumeru server { start | stop | status }

sumeru session list
sumeru session get <id>
sumeru session add <prototype> --project <path> --task <description> [--env KEY=VAL]
sumeru session send <id> "message" [--model <model-id>] [--env KEY=VAL]
sumeru session stop <id>
sumeru session remove <id>
sumeru session logs <id> [--follow]
sumeru session turns <id> [--after N]
sumeru session exec <id> -- <command...>
sumeru session model <id> <model-id>
sumeru session reset <id> [--persona <name>]
sumeru session snapshot <id> <name>

sumeru adapter { list | get | models } <name>
sumeru provider { list | get | add | update | remove } <name>
sumeru model { list | get | add | update | remove } <name>
sumeru prototype { list | get | add | update | remove } <name>
sumeru extension { list | get | put | remove } <name>
sumeru persona { list | get | add | update | remove } <name>
sumeru skill { get | put | remove } <name>
sumeru search <query> [--session <id>]
```

## Usage example

```bash
sumeru setup --provider anthropic --api-key sk-... --model claude-sonnet-4
sumeru server start
sumeru session add sarsapa --project ./repo --task "fix the bug"
sumeru session send ses_01... "start with tests/" --model copilot:opus
sumeru session logs ses_01... --follow
sumeru session exec ses_01... -- npm test
sumeru session turns ses_01... --after 5
```

```typescript
import { createHostClient } from "@sumeru/cli";

const client = createHostClient({ baseUrl: "http://127.0.0.1:7900" });
const root = await client.getRoot();
const sessions = await client.listSessions();
```

Version **0.3.0**.
