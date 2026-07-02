# @sumeru/cli — CLI client for the Sumeru Host API

## What it does

Command-line interface for managing a Sumeru instance. Wraps the Host HTTP API with typed commands, table formatting, and local helpers (`setup`, `image build`, `server start/stop`). Built on `@ocas/cli-kit`.

Default Host address: `http://127.0.0.1:7900` (override with `--host` / `--port` or `SUMERU_HOST` / `SUMERU_PORT`).

## API / Exports

Library surface (for programmatic use):

- `createHostClient(options)` — typed HTTP client for all Host endpoints
- `formatTable`, `formatHostStatus`, `TableColumn`

**Binary:** `sumeru`.

## Command tree

```
sumeru setup
sumeru server { start | stop | status }
sumeru adapter { list | get | models } <name>
sumeru provider { list | get | add | update | remove } <name>
sumeru model { list | get | add | update | remove } <provider:name>
sumeru prototype { list | get | add | update | remove } <name>
sumeru extension { list | get | put | remove } <name>
sumeru persona { list | get | add | update | remove } <name>
sumeru skill { get | put | remove } <name>
sumeru image build <name> --agent <type>
sumeru session { list | get | add | stop | remove | send | logs } <id>
sumeru search <query>
```

## Usage example

```bash
sumeru setup --provider siliconflow --api-key sk-... --model deepseek-ai/DeepSeek-V3
sumeru server start
sumeru session add my-agent --project ./repo --task "fix the bug"
sumeru session send ses_01... "start with tests/"
sumeru session logs ses_01... --follow
```

```typescript
import { createHostClient } from "@sumeru/cli";

const client = createHostClient({ baseUrl: "http://127.0.0.1:7900" });
const root = await client.getRoot();
```

Version **0.3.0**.
