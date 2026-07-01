---
scenario: Persona 引用不存在的 Skill 时校验失败
feature: Skill 引用校验
tags: [persona, skill, validation, error]
---

# Persona Skill 引用校验

创建或更新 Persona 时，`skills` 数组中引用的每个 skill 必须在 SQLite 中实际存在。若存在不存在的 skill 引用，返回 `400` 并明确列出缺失的 skill 名称。

## 背景

Phase 2 后 skills 从 Prototype 移到了 Persona（SQLite 实体）。Persona handler 中的 `findMissingSkills()` 函数逐一检查 skills 数组中每个 skill 名称是否在 SQLite 的 skills 表中存在。

---

## Scenario: 创建 Persona 引用不存在的 Skill

**Given** 系统中存在 skill `bash`，但不存在 skill `docker` 和 `kubernetes`

**When** 发送请求：

```http
POST /personas/deploy-agent
Content-Type: application/json

{
  "instructions": "Handles deployment tasks.",
  "skills": ["bash", "docker", "kubernetes"]
}
```

**Then** 响应状态码为 `400`：

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skills_not_found",
    "message": "Missing skills: docker, kubernetes"
  }
}
```

---

## Scenario: 更新 Persona 引用不存在的 Skill

**Given** 存在 persona `deploy-agent`，系统中不存在 skill `terraform`

**When** 发送请求：

```http
PUT /personas/deploy-agent
Content-Type: application/json

{
  "instructions": "Updated instructions.",
  "skills": ["terraform"]
}
```

**Then** 响应状态码为 `400`，error code 为 `skills_not_found`

---

## Scenario: 创建 Persona 引用全部存在的 Skill

**Given** 系统中存在 skill `bash` 和 `git`

**When** 发送请求：

```http
POST /personas/code-reviewer
Content-Type: application/json

{
  "instructions": "Reviews code changes.",
  "skills": ["bash", "git"]
}
```

**Then** 响应状态码为 `201`

---

## Scenario: 创建 Persona 空 skills 数组

**When** 发送请求：

```http
POST /personas/minimal-agent
Content-Type: application/json

{
  "instructions": "Minimal agent.",
  "skills": []
}
```

**Then** 响应状态码为 `201`（空数组跳过校验）
