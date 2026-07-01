---
test: Create persona referencing multiple nonexistent skills
spec: skill-reference-validation
tags: [persona, skill, validation, error]
---

# TC: Create Persona With Multiple Missing Skills

## Purpose
Verify that creating a persona referencing multiple nonexistent skills returns HTTP 400 with error code `skills_not_found` and a message listing all missing skill names.

## Preconditions
- No skills named `alpha`, `beta`, or `gamma` exist in the system

## Steps

1. **POST** `/personas/multi-fail` with body:
```json
{
  "instructions": "Test multiple missing skills.",
  "skills": ["alpha", "beta", "gamma"]
}
```

## Expected Result

- HTTP status: `400`
- Response body:
```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skills_not_found",
    "message": "Missing skills: alpha, beta, gamma"
  }
}
```

## Assertions
- Status code is 400
- `type` equals `@sumeru/error`
- `value.error` equals `skills_not_found`
- `value.message` contains `alpha`
- `value.message` contains `beta`
- `value.message` contains `gamma`

## Cleanup
```bash
curl -s -X DELETE $HOST/personas/multi-fail
```
