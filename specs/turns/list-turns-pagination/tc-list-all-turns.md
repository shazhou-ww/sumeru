---
tc: List all turns for a session
spec: list-turns-pagination
tags: [turns, pagination, smoke]
---

# TC: List All Turns

## Steps

1. POST /sessions with prototype='hermes', project='sumeru', task='List the files in /tmp directory'
2. Poll GET /sessions/:id until status=idle
3. GET /sessions/:id/turns (no query params)

## Expected

- Status 200
- Response has `turns` array (or envelope with value)
- Each turn has an integer `id` starting at 0, incrementing sequentially
- Each turn has `role` field being either 'assistant' or 'tool'
- Array is non-empty (at least one assistant turn)
