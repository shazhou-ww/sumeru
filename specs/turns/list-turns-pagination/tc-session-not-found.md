---
tc: Session not found returns 404
spec: list-turns-pagination
tags: [turns, pagination, error]
---

# TC: Session Not Found

## Steps

1. GET /sessions/ses_FAKE_NONEXISTENT/turns

## Expected

- Status 404
- Response body has error.code = 'session_not_found'
