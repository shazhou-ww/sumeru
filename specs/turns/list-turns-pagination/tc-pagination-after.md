---
tc: Pagination with after parameter
spec: list-turns-pagination
tags: [turns, pagination]
---

# TC: Pagination with ?after=0

## Steps

1. Using a session that already has turns (from previous test)
2. GET /sessions/:id/turns?after=0

## Expected

- Status 200
- Response returns only turns with id > 0
- First turn in response has id >= 1
- No turn has id == 0
