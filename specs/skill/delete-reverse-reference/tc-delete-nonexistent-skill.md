---
test: Delete a skill that does not exist
expects: 404 Not Found with skill_not_found error
---

# TC: Delete Nonexistent Skill → 404

## Setup

- No setup needed; skill `tc-nonexistent-xyz` must NOT exist

## Action

```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://127.0.0.1:7901/skills/tc-nonexistent-xyz
```

## Expected

- HTTP 404 Not Found
- Response body contains `"error": "skill_not_found"`
- Response body message includes skill name `tc-nonexistent-xyz`

## Teardown

- No cleanup needed
