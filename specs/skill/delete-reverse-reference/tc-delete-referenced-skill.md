---
test: Delete a skill that is referenced by a prototype
expects: 409 Conflict with skill_referenced error and prototype name in message
---

# TC: Delete Referenced Skill → 409

## Setup

1. Create skill `tc-ref-skill` via PUT /skills/tc-ref-skill
2. Create prototype `tc-ref-proto` via PUT /prototypes/tc-ref-proto with skills: ["tc-ref-skill"]

## Action

```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://127.0.0.1:7901/skills/tc-ref-skill
```

## Expected

- HTTP 409 Conflict
- Response body contains `"error": "skill_referenced"`
- Response body message includes prototype name `tc-ref-proto`

## Teardown

1. Update prototype `tc-ref-proto` to remove skill reference (PUT with skills: [])
2. DELETE /skills/tc-ref-skill
3. DELETE /prototypes/tc-ref-proto
