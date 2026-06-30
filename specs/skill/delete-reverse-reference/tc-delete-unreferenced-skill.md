---
test: Delete a skill that has no prototype referencing it
expects: 204 No Content, subsequent GET returns 404
---

# TC: Delete Unreferenced Skill → 204

## Setup

1. Create skill `tc-unref-skill` via PUT /skills/tc-unref-skill (no prototype references it)

## Action

```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://127.0.0.1:7901/skills/tc-unref-skill
```

## Expected

- HTTP 204 No Content
- Empty response body
- Subsequent GET /skills/tc-unref-skill returns 404

## Teardown

- No cleanup needed (skill already deleted by test action)
