# Persona 完整行为规格

Persona 是 Agent 角色配置（SQLite 实体，Phase 2 新增）。Persona = pure system prompt text。

本文档是 Persona 领域的权威行为规格，涵盖 API 和 CLI 行为。

---

## 1. Persona 字段

```json
{
  "name": "general",
  "instructions": "A general-purpose coding agent.",
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | 唯一标识，来自 URL `:name` |
| instructions | string | ✅ | Agent 指令文本（system prompt） |
| createdAt | string | auto | ISO 8601 创建时间 |
| updatedAt | string | auto | ISO 8601 更新时间 |

---

## 2. API

### 端点

| Method | Path | 说明 |
|--------|------|------|
| GET | /personas | 列出所有 |
| GET | /personas/:name | 单个详情 |
| PUT | /personas/:name | upsert（201 新建 / 200 替换 / 400） |
| DELETE | /personas/:name | 删除（204 / 404 / 409） |

### PUT Body

```json
{
  "instructions": "Your system prompt text here."
}
```

PUT 使用 merge 语义 — 省略的字段保留现有值。

### 响应信封

```json
{ "type": "@sumeru/persona", "value": { ... } }
{ "type": "@sumeru/persona-list", "value": [ ... ] }
```

### 删除保护

删除 Persona 时若有 Prototype 引用它（YAML `persona:` 字段），返回 `409 persona_in_use`。

### API Scenarios

#### 列出所有 Persona

**When** `GET /personas`

**Then** 200，返回 `@sumeru/persona-list`

**Then** 每项包含 name、instructions（前 100 字符）

#### 创建 Persona

**Given** Persona "coder" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/personas/coder \
  -H "Content-Type: application/json" \
  -d '{"instructions":"You are a professional software engineer."}'
```

**Then** 201 created
```json
{ "type": "@sumeru/persona", "value": { "name": "coder", "instructions": "You are a professional software engineer." } }
```

#### 更新 Persona (merge)

**Given** Persona "coder" 已存在

**When**
```bash
curl -s -X PUT http://localhost:3000/personas/coder \
  -H "Content-Type: application/json" \
  -d '{"instructions":"You are an expert Python developer."}'
```

**Then** 200 updated
```json
{ "type": "@sumeru/persona", "value": { "name": "coder", "instructions": "You are an expert Python developer." } }
```

#### 删除 Persona

**When** `DELETE /personas/coder`

**Then** 204 No Content

**When** `GET /personas/coder`

**Then** 404 `persona_not_found`

#### 删除被引用的 Persona

**Given** Persona "coder" 被 Prototype "my-agent" 引用

**When** `DELETE /personas/coder`

**Then** 409 `persona_in_use`
```json
{ "type": "@sumeru/error", "value": { "code": "persona_in_use", "message": "Persona coder is referenced by 1 prototype(s)" } }
```

#### 获取不存在的 Persona

**When** `GET /personas/nonexistent`

**Then** 404 `persona_not_found`

#### PUT 空 instructions

**When**
```bash
curl -s -X PUT http://localhost:3000/personas/empty \
  -H "Content-Type: application/json" \
  -d '{"instructions":""}'
```

**Then** 400 `invalid_request`
```json
{ "type": "@sumeru/error", "value": { "code": "invalid_request", "message": "instructions cannot be empty" } }
```

---

## 3. CLI 命令

### 3.1 sumeru persona add

创建 persona（系统提示词）。

#### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Persona 名称（位置参数） |
| --instructions | string | 是 | - | 系统提示词文本 |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

#### 用例

**用例 1：正常创建 persona**

**前置条件**：persona "coder" 不存在

**命令**：
```bash
sumeru persona add coder --instructions "You are a professional software engineer."
```

**text**：
```
Created persona coder
```

**json**：
```json
{
  "name": "coder"
}
```

**副作用**：
- persona "coder" 出现在 `sumeru persona list` 中

**用例 2：重复名称（upsert）**

**前置条件**：persona "coder" 已存在

**命令**：
```bash
sumeru persona add coder --instructions "New instructions"
```

**行为**：API 使用 upsert 语义，已存在的 persona 会被更新（200 OK），而非报错

**用例 3：缺少 --instructions**

**命令**：
```bash
sumeru persona add coder
```

**退出码**：非 0

**输出**：包含 "--instructions is required" 的提示信息

**副作用**：无

---

### 3.2 sumeru persona get

获取 persona 详情。

#### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Persona 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

#### 用例

**用例 1：获取存在的 persona**

**前置条件**：persona "coder" 存在

**命令**：
```bash
sumeru persona get coder
```

**text**：
```
Name: coder
Instructions: You are a professional software engineer.
```

**json**：
```json
{
  "name": "coder",
  "instructions": "You are a professional software engineer."
}
```

**用例 2：获取不存在的 persona**

**前置条件**：persona "nonexistent" 不存在

**命令**：
```bash
sumeru persona get nonexistent
```

**退出码**：非 0

**输出**：包含 "not found" 或 "persona_not_found" 的错误信息

**副作用**：无

---

### 3.3 sumeru persona list

列出所有 persona。

#### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

#### 用例

**用例 1：正常列出 persona**

**前置条件**：系统中存在至少一个 persona

**命令**：
```bash
sumeru persona list
```

**text**：
```
[coder]
You are a professional software engineer.

[expert]
You are an expert Python developer.
```

**json**：
```json
[
  {
    "name": "coder",
    "instructions": "You are a professional software engineer."
  },
  {
    "name": "expert",
    "instructions": "You are an expert Python developer."
  }
]
```

**用例 2：空列表**

**前置条件**：系统中没有 persona

**命令**：
```bash
sumeru persona list
```

**text**：
```
(empty)
```

**json**：
```json
[]
```

**副作用**：无

---

### 3.4 sumeru persona remove

删除 persona。

#### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Persona 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

#### 用例

**用例 1：正常删除 persona**

**前置条件**：persona "coder" 存在且未被 prototype 引用

**命令**：
```bash
sumeru persona remove coder
```

**text**：
```
Removed persona coder
```

**json**：
```json
{
  "message": "Removed persona coder"
}
```

**副作用**：
- persona "coder" 从 `sumeru persona list` 中消失

**用例 2：被 prototype 引用（409）**

**前置条件**：persona "coder" 存在，且被 prototype "my-agent" 引用

**命令**：
```bash
sumeru persona remove coder
```

**退出码**：非 0

**输出**：包含 "persona_in_use" 的错误信息

**副作用**：
- persona "coder" 仍然存在

**用例 3：persona 不存在**

**前置条件**：persona "nonexistent" 不存在

**命令**：
```bash
sumeru persona remove nonexistent
```

**退出码**：非 0

**输出**：包含 "not found" 或 "persona_not_found" 的错误信息

**副作用**：无
