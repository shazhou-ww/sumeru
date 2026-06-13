---
scenario: "sumeru start launches the HTTP server and prints the listening address"
feature: cli-start
tags: [cli, server, http, listen]
---

## Given
- `pnpm run build` has been run successfully from the repo root.
- `@sumeru/cli` exposes a new subcommand `start` that boots a `@sumeru/server` HTTP listener.
- The CLI accepts these options on `sumeru start`:
  - `-p, --port <number>` — TCP port to bind. Default `7900`. Passing `0` means "let the OS pick a free port".
  - `-h, --host <host>` — bind address. Default `127.0.0.1`.
- The server uses either `node:http` directly or a lightweight framework (Hono is the recommended choice) — no Express, no Fastify, no Koa.
- No `sumeru.yaml` config file is required; defaults are sufficient for Phase 0.

## When
- The contributor runs `sumeru start --port 0` from the worktree root (i.e. `node packages/cli/dist/cli.js start --port 0` or via the linked `sumeru` bin).

## Then
- The process stays in the foreground and writes a single line to stdout matching the regex `^Listening on http://127\.0\.0\.1:[0-9]+$` within 2 seconds of launch.
- The printed port is a real bound TCP port — `curl -fsS http://127.0.0.1:<port>/` succeeds with HTTP 200 (covered in `server-instance-endpoint.md`).
- `SIGINT` (Ctrl-C) causes the process to exit 0 within 1 second and releases the port.
- Running `sumeru start --port 7900` twice in a row makes the second invocation exit non-zero with a clear `EADDRINUSE` error message on stderr (no stack trace from `node:http` internals leaking through unfiltered).
- `sumeru start --help` lists `--port` and `--host` with their defaults.
