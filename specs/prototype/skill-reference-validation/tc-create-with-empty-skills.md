---
test: Create persona with empty skills array
spec: skill-reference-validation
tags: [persona, skill, validation, success]
---

# TC: Create Persona With Empty Skills Array

## Purpose
Verify that creating a persona with an empty skills array succeeds (no validation needed when no skills are referenced).

## Preconditions
- None specific (empty skills bypasses validation)

## Steps

1. **POST** `/personas/no-skills-persona` with body:
```json
{
  "instructions": "Agent without skills.",
  "skills": []
}
```

## Expected Result

- HTTP status: `201`
- Response body:
```json
{
  "type": "@sumeru/persona",
  "value": {
    "name": "no-skills-persona",
    "instructions": "Agent without skills.",
    "skills": [],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Assertions
- Status code is 201
- `type` equals `@sumeru/persona`
- `value.skills` is an empty array

## Cleanup
```bash
curl -s -X DELETE $HOST/personas/no-skills-persona
```
