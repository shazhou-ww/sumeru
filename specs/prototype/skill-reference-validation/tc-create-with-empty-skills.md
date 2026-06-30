---
test: Create prototype with empty skills array
spec: skill-reference-validation
tags: [prototype, skill, validation, success]
---

# TC: Create Prototype With Empty Skills Array

## Purpose
Verify that creating a prototype with an empty skills array succeeds (no validation needed when no skills are referenced).

## Preconditions
- None specific (empty skills bypasses validation)

## Steps

1. **POST** `/prototypes/no-skills-proto` with body:
```json
{
  "name": "no-skills-proto",
  "instructions": "Agent without skills.",
  "skills": []
}
```

## Expected Result

- HTTP status: `201`
- Response body:
```json
{
  "type": "@sumeru/prototype",
  "value": {
    "name": "no-skills-proto",
    "instructions": "Agent without skills.",
    "skills": [],
    "defaults": null
  }
}
```

## Assertions
- Status code is 201
- `type` equals `@sumeru/prototype`
- `value.name` equals `no-skills-proto`
- `value.skills` equals `[]`
