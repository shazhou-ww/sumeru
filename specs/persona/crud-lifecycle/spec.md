---
scenario: Persona 完整 CRUD 生命周期
feature: Persona CRUD API
tags: [persona, crud, lifecycle, sqlite]
---

# Persona 完整 CRUD 生命周期

Persona 是 Agent 角色配置（SQLite 实体，Phase 2 新增）。包含 instructions 和 skills 引用。

## Persona 字段

```json
{
  "name": "general",
  "instructions": "A general-purpose coding agent.",
  "skills": ["bash", "git"],
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | 唯一标识，来自 URL `:name` |
| instructions | string | ✅ | Agent 指令文本 |
| skills | string[] | ❌ | Skill 名称数组（引用 SQLite skills 表） |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /personas | 列出所有 |
| GET | /personas/:name | 单个详情 |
| PUT | /personas/:name | upsert（201 新建 / 200 替换 / 400） |
| DELETE | /personas/:name | 删除（204 / 404 / 409） |

PUT 使用 merge 语义 — 省略的字段保留现有值。

### Skills 引用校验

创建/更新 Persona 时 `skills` 中的每个 skill 必须在 SQLite skills 表中存在，否则返回 `400 skills_not_found`。

### 删除保护

删除 Persona 时若有 Prototype 引用它（YAML `persona:` 字段），返回 `409 persona_in_use`。

### 响应信封

```json
{ "type": "@sumeru/persona", "value": { ... } }
{ "type": "@sumeru/persona-list", "value": [ ... ] }
```
