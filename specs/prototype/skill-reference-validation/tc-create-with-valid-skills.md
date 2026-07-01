---
test: Create persona referencing a valid skill
spec: skill-reference-validation
tags: [persona, skill, validation, success]
---

# TC: Create Persona With Valid Skills

## Purpose
Verify that creating a persona referencing an existing skill succeeds with HTTP 201.

## Preconditions
- A skill named `test-skill` must exist (created via PUT /skills/test-skill)

## Setup

1. **PUT** `/skills/test-skill` with body:
```json
{
  "name": "test-skill",
  "content": "# Test Skill\nA test skill for validation."
}
```

## Steps

2. **POST** `/personas/valid-persona` with body:
```json
{
  "instructions": "Agent with valid skills.",
  "skills": ["test-skill"]
}
```

## Expected Result

- HTTP status: `201`
- Response body:
```json
{
  "type": "@sumeru/persona",
  "value": {
    "name": "valid-persona",
    "instructions": "Agent with valid skills.",
    "skills": ["test-skill"],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Assertions
- Status code is 201
- `type` equals `@sumeru/persona`
- `value.skills` contains `test-skill`

## Cleanup
```bash
curl -s -X DELETE $HOST/personas/valid-persona
curl -s -X DELETE $HOST/skills/test-skill
```
