---
test: Create prototype referencing a valid skill
spec: skill-reference-validation
tags: [prototype, skill, validation, success]
---

# TC: Create Prototype With Valid Skills

## Purpose
Verify that creating a prototype referencing an existing skill succeeds with HTTP 201 and returns the prototype.

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

2. **POST** `/prototypes/valid-proto` with body:
```json
{
  "name": "valid-proto",
  "instructions": "Agent with valid skills.",
  "skills": ["test-skill"]
}
```

## Expected Result

- HTTP status: `201`
- Response body:
```json
{
  "type": "@sumeru/prototype",
  "value": {
    "name": "valid-proto",
    "instructions": "Agent with valid skills.",
    "skills": ["test-skill"],
    "defaults": null
  }
}
```

## Assertions
- Status code is 201
- `type` equals `@sumeru/prototype`
- `value.name` equals `valid-proto`
- `value.skills` contains `test-skill`
