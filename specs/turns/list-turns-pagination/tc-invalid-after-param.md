---
tc: Invalid after parameter returns 400
spec: list-turns-pagination
tags: [turns, pagination, error]
---

# TC: Invalid ?after param (non-integer)

## Steps

1. Using a valid session id
2. GET /sessions/:id/turns?after=abc

## Expected

- Status 400
- Response body has error.code = 'invalid_request'
- error.message mentions 'after' parameter
