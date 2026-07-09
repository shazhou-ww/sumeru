---
scenario: CLI error experience — friendly error messages for common failure modes
feature: CLI Error Experience
tags: [cli, errors, ux, error-handling]
---

# CLI Error Experience

## Error Handling Architecture

| Component | 说明 |
|-----------|------|
| HostClientError | Wraps connection and HTTP errors from host |
| handleClientError() | Extracts message for display |
| process.stderr | All error output goes to stderr as plain text |

### Output Format

All errors are printed as plain text to **stderr**:

```
Error: <message>
```

- No JSON envelope on errors
- No error codes prefixed
- No stack traces in normal operation

### E_USAGE Errors

For usage errors (bad command, missing required arguments), the CLI:
1. Prints `Error: <message>` to stderr
2. Also prints relevant help/usage information to **stdout**

```
Error: Missing required argument: prototype

Usage: sumeru session add <prototype> [--project <p>] [--task <t>]
```

### Version

```bash
sumeru --version   # prints version string, e.g. "0.1.0"
sumeru -v          # same as --version
```

### No Arguments (Help)

```bash
sumeru             # shows help with command descriptions to stdout
```

---

## Given
- Host is NOT running (no process on expected port)

## When — execute any command against host
```bash
sumeru session list
```

## Then — friendly connection error (not raw ECONNREFUSED)
```
Error: Cannot connect to host at 127.0.0.1:7900
```
- Output goes to stderr
- No stack trace
- No raw Node.js error
- HostClientError wraps the connection failure

---

## When — execute prototype list against dead host
```bash
sumeru prototype list
```

## Then — same friendly error
```
Error: Cannot connect to host at 127.0.0.1:7900
```

---

## Given
- Host is running and healthy

## When — reference nonexistent session
```bash
sumeru session get nonexistent-id
```

## Then — session_not_found error
```
Error: Session not found
```
- No stack trace
- Clean single-line output to stderr

---

## When — reference nonexistent prototype
```bash
sumeru prototype get nonexistent
```

## Then — prototype_not_found error
```
Error: Prototype not found
```

---

## When — missing required argument for session add
```bash
sumeru session add
```

## Then — usage hint (E_USAGE)
stderr:
```
Error: Missing required argument: prototype
```
stdout:
```
Usage: sumeru session add <prototype> [--project <p>] [--task <t>]
```
- No crash, no stack trace

---

## When — missing required argument for prototype add
```bash
sumeru prototype add
```

## Then — usage hint (E_USAGE)
stderr:
```
Error: Missing required argument: name
```
stdout:
```
Usage: sumeru prototype add <name>
```

---

## When — invalid model ID format in model command
```bash
sumeru session model sess-001 invalid-format
```

## Then — format error
```
Error: Invalid model ID "invalid-format". Expected format: provider:name
```

---

## When — model command with nonexistent model
```bash
sumeru session model sess-001 fake:nonexistent
```

## Then — model_not_found error
```
Error: Model not found
```

---

## When — nonexistent subcommand
```bash
sumeru session bogus
```

## Then — help suggestion (E_USAGE)
stderr:
```
Error: Unknown command: bogus
```
stdout:
```
Available commands: list, add, send, turns, logs, stop, remove, exec, reset, snapshot, model
```

---

## When — network timeout
```bash
sumeru session list
```

## Then — timeout error (not raw error)
```
Error: Request timed out connecting to host at 127.0.0.1:7900
```

---

## When — sumeru with no arguments
```bash
sumeru
```

## Then — help output to stdout
```
Usage: sumeru <command> [options]

Commands:
  server    Manage the host server process
  adapter   View available adapters
  provider  Manage LLM providers
  model     Manage model configurations
  prototype Manage session prototypes
  persona   Manage personas
  session   Manage and interact with sessions
  search    Search session content

Options:
  --version, -v  Show version
  --help, -h     Show help
```

---

## When — sumeru --version
```bash
sumeru --version
```

## Then — version string to stdout
```
0.1.0
```

---

## Notes
- All CLI errors output plain text to stderr: `Error: <message>`
- No JSON envelope on error output
- E_USAGE errors (bad command, missing args) additionally print relevant help to stdout
- `sumeru --version` / `-v` prints version string to stdout
- `sumeru` (no args) shows help with command descriptions to stdout
- HostClientError wraps both connection errors and HTTP error responses
- Missing arguments trigger E_USAGE with help output
- Connection errors (ECONNREFUSED, ETIMEDOUT) are caught and wrapped
- HTTP error responses (4xx, 5xx) extract the error message from the response body
- The goal is: users never see raw Node.js errors or stack traces in normal operation
