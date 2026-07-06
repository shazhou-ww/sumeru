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
| handleClientError() | Extracts code + message for display |
| ctx.error() | Prints message and exits process |

### Output Format

```
<code>: <message>
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
connection_error: Cannot connect to host at localhost:3000
```
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
connection_error: Cannot connect to host at localhost:3000
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
session_not_found: Session not found
```
- No stack trace
- Clean single-line output

---

## When — reference nonexistent prototype
```bash
sumeru prototype get nonexistent
```

## Then — prototype_not_found error
```
prototype_not_found: Prototype not found
```

---

## When — missing required argument for session add
```bash
sumeru session add
```

## Then — usage hint
```
Usage: sumeru session add <prototype>
```
- CLI uses ctx.error() to print and exit
- No crash, no stack trace

---

## When — missing required argument for prototype add
```bash
sumeru prototype add
```

## Then — usage hint
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
model_invalid_format: Invalid model ID "invalid-format". Expected format: provider:name
```

---

## When — model command with nonexistent model
```bash
sumeru session model sess-001 fake:nonexistent
```

## Then — model_not_found error
```
model_not_found: Model not found
```

---

## When — nonexistent subcommand
```bash
sumeru session bogus
```

## Then — help suggestion
```
Unknown command: bogus

Available commands: list, get, add, remove, model
```

---

## When — network timeout
```bash
sumeru session list
```

## Then — timeout error (not raw error)
```
connection_error: Request timed out connecting to host at localhost:3000
```

---

## Notes
- All CLI commands use handleClientError() to normalize error output
- HostClientError wraps both connection errors and HTTP error responses
- Output format is always `<code>: <message>` — one line, no stack traces
- Missing arguments trigger usage hints via ctx.error() which prints and exits
- Connection errors (ECONNREFUSED, ETIMEDOUT) are caught and wrapped
- HTTP error responses (4xx, 5xx) extract the error envelope code + message
- The goal is: users never see raw Node.js errors or stack traces in normal operation
