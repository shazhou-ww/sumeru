---
test: Create persona referencing a nonexistent skill
spec: skill-reference-validation
tags: [persona, skill, validation, error]
---

# TC: Create Persona With Missing Skills

## Purpose
Verify that creating a persona referencing a skill that does not exist returns HTTP 400 with error code `skills_not_found`.

## Preconditions
- No skill named `nonexistent` exists in the system

## Steps

1. **POST** `/personas/test-persona` with body:
```json
{
  "instructions": "Test persona with missing skill.",
  "skills": ["nonexistent"]
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
    "message": "Missing skills: nonexistent"
  }
}
```

## Assertions
- Status code is 400
- `type` equals `@sumeru/error`
- `value.error` equals `skills_not_found`
- `value.message` contains `nonexistent`
