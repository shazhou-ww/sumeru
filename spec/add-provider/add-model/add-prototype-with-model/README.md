# Prototype CRUD Lifecycle

## Prototype 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✓ | From URL path, unique identifier |
| persona | string | ✓ | Must reference existing Persona in SQLite |
| model | string\|null | conditional | Model ID; must exist in SQLite. Null only if adapter.providerMode === "builtin-only" |
| adapter | string | ✓ | Must reference existing adapter in adapter registry |
| image | string\|null | ✗ | Docker image override |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /prototypes | List all prototypes |
| GET | /prototypes/:name | Get single prototype |
| PUT | /prototypes/:name | Create or update (upsert) |
| DELETE | /prototypes/:name | Remove prototype |

### 响应信封

```json
{ "type": "@sumeru/prototype-list", "value": [...] }
{ "type": "@sumeru/prototype", "value": { "name": "...", "persona": "...", "model": "...", "adapter": "...", "image": null } }
```

---

## Scenario: 列出所有 Prototype

**When** `GET /prototypes`

**Then** 200，返回 `@sumeru/prototype-list`

**Then** 每项包含 name、persona、model、adapter

---

## Scenario: 创建 Prototype

**Given** Host is running and healthy

**Given** SQLite contains Persona "coder" and Model "openai:gpt-4"

**Given** Adapter registry contains adapter "docker"

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"docker"}'
```

**Then** 201 created
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "image": null } }
```

---

## Scenario: 获取 Prototype

**When** `GET /prototypes/my-agent`

**Then** 200 prototype detail
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "openai:gpt-4", "adapter": "docker", "image": null } }
```

---

## Scenario: 更新 Prototype (merge)

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic:claude-3"}'
```

**Then** 200 updated (merged fields)
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": "anthropic:claude-3", "adapter": "docker", "image": null } }
```

---

## Scenario: 删除 Prototype

**When** `DELETE /prototypes/my-agent`

**Then** 204 No Content

**When** `GET /prototypes/my-agent`

**Then** 404 `prototype_not_found`

---

## Scenario: 创建时 Persona 不存在

**Given** Persona "nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"nonexistent","model":"openai:gpt-4","adapter":"docker"}'
```

**Then** 400 `persona_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "persona_not_found", "message": "Persona not found" } }
```

---

## Scenario: 创建时 Adapter 不存在

**Given** Adapter "nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:gpt-4","adapter":"nonexistent"}'
```

**Then** 400 `adapter_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "adapter_not_found", "message": "Adapter not found" } }
```

---

## Scenario: 创建时 Model 不存在

**Given** Model "openai:nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":"openai:nonexistent","adapter":"docker"}'
```

**Then** 400 `model_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "model_not_found", "message": "Model not found" } }
```

---

## Scenario: 非 builtin-only Adapter 时 Model 为 null

**Given** Adapter "docker" 的 providerMode === "custom-only"

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/bad-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":null,"adapter":"docker"}'
```

**Then** 400 `model_required`
```json
{ "type": "@sumeru/error", "value": { "code": "model_required", "message": "Model is required for this adapter" } }
```

---

## Scenario: builtin-only Adapter 时 Model 为 null

**Given** Adapter "claude-code" 的 providerMode === "builtin-only"

**When**
```bash
curl -s -X PUT http://localhost:3000/prototypes/my-agent \
  -H "Content-Type: application/json" \
  -d '{"persona":"coder","model":null,"adapter":"claude-code"}'
```

**Then** 201 created（model 为 null 合法）
```json
{ "type": "@sumeru/prototype", "value": { "name": "my-agent", "persona": "coder", "model": null, "adapter": "claude-code", "image": null } }
```

---

## Notes
- Prototypes are stored as YAML files on disk (not SQLite)
- PUT is upsert: 201 for new, 200 for existing (merge semantics on update)
- On create failure (e.g. compose validation), the YAML file is rolled back (deleted)
- Model null is allowed only when adapter.providerMode === "builtin-only"
- CLI: `sumeru prototype list/get/add/update/remove`

---

## CLI: sumeru prototype add

### 描述

注册新的 prototype（指定 adapter、model、persona 组合）。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --model | string | 是 | - | Model registry 名称 |
| --adapter | string | 是 | - | Adapter 名称 |
| --persona | string | 否 | default | Persona 名称 |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：正常创建 prototype

**前置条件**：
- Model "openai:gpt-4" 存在
- Adapter "docker" 存在
- Persona "coder" 存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter docker --persona coder
```

**后置条件**：

**text**：
```
Created prototype my-agent
```

**json**：
```json
{
  "name": "my-agent"
}
```

**副作用**：
- prototype "my-agent" 出现在 `sumeru prototype list` 中

#### 用例 2：重复名称

**前置条件**：prototype "my-agent" 已存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter docker
```

**后置条件**：

**行为**：API 使用 upsert 语义，已存在的 prototype 会被更新（200 OK），而非报错

#### 用例 3：model 不存在

**前置条件**：Model "nonexistent:model" 不存在

**命令**：
```bash
sumeru prototype add my-agent --model nonexistent:model --adapter docker
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "model_not_found" 的错误信息

#### 用例 4：adapter 不存在

**前置条件**：Adapter "nonexistent" 不存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "adapter_not_found" 的错误信息

#### 用例 5：persona 不存在

**前置条件**：Persona "nonexistent" 不存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter docker --persona nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "persona_not_found" 的错误信息

---

## CLI: sumeru prototype get

### 描述

获取指定 prototype 的详细信息。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：获取存在的 prototype

**前置条件**：prototype "my-agent" 存在

**命令**：
```bash
sumeru prototype get my-agent
```

**后置条件**：

**text**：
```
Name: my-agent
Adapter: docker
Model: openai:gpt-4
Persona: coder
```

**json**：
```json
{
  "name": "my-agent",
  "adapter": "docker",
  "model": "openai:gpt-4",
  "persona": "coder"
}
```

#### 用例 2：获取不存在的 prototype

**前置条件**：prototype "nonexistent" 不存在

**命令**：
```bash
sumeru prototype get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "prototype_not_found" 的错误信息

**副作用**：无

---

## CLI: sumeru prototype list

### 描述

列出所有已注册的 prototype。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

### 用例

#### 用例 1：正常列出 prototype

**前置条件**：系统中存在至少一个 prototype

**命令**：
```bash
sumeru prototype list
```

**后置条件**：

**text**：
```
#  NAME        ADAPTER   MODEL         PERSONA
-  ----------  --------  ------------  ---------
1  my-agent    docker    openai:gpt-4  coder
```

**json**：
```json
[
  {
    "name": "my-agent",
    "adapter": "docker",
    "model": "openai:gpt-4",
    "persona": "coder"
  }
]
```

#### 用例 2：空列表

**前置条件**：系统中没有 prototype

**命令**：
```bash
sumeru prototype list
```

**后置条件**：

**text**：
```
(empty)
```

**json**：
```json
[]
```

#### 用例 3：分页

**前置条件**：系统中有 5 个 prototype

**命令**：
```bash
sumeru prototype list --limit 2
```

**后置条件**：

**text**：返回最多 2 条记录，并提示使用 `--offset` 查看更多

**json**：返回最多 2 个对象的数组

**副作用**：无

---

## CLI: sumeru prototype remove

### 描述

删除 prototype。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：正常删除 prototype

**前置条件**：prototype "my-agent" 存在且未被 session 引用

**命令**：
```bash
sumeru prototype remove my-agent
```

**后置条件**：

**text**：
```
Removed prototype my-agent
```

**json**：
```json
{
  "message": "Removed prototype my-agent"
}
```

**副作用**：
- prototype "my-agent" 从 `sumeru prototype list` 中消失

#### 用例 2：被 session 引用

**前置条件**：prototype "my-agent" 存在，且有活跃 session 使用此 prototype

**命令**：
```bash
sumeru prototype remove my-agent
```

**后置条件**：

**行为**：可能返回 409 Conflict 错误，提示 prototype 正在使用中（具体行为需确认源码实现）

#### 用例 3：prototype 不存在

**前置条件**：prototype "nonexistent" 不存在

**命令**：
```bash
sumeru prototype remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "prototype_not_found" 的错误信息

**副作用**：无

---

## CLI: sumeru prototype update

### 描述

更新已有 prototype 的属性（model/adapter/persona）。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --model | string | 否 | - | 新的 Model registry 名称 |
| --adapter | string | 否 | - | 新的 Adapter 名称 |
| --persona | string | 否 | - | 新的 Persona 名称 |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：更新 model

**前置条件**：prototype "my-agent" 存在，当前 model 为 "openai:gpt-4"

**命令**：
```bash
sumeru prototype update my-agent --model anthropic:claude-3
```

**后置条件**：

**text**：
```
Updated prototype my-agent
```

**json**：
```json
{
  "name": "my-agent"
}
```

**副作用**：
- prototype "my-agent" 的 model 字段更新为 "anthropic:claude-3"

#### 用例 2：更新 persona

**前置条件**：prototype "my-agent" 存在

**命令**：
```bash
sumeru prototype update my-agent --persona expert
```

**后置条件**：

**text**：
```
Updated prototype my-agent
```

**副作用**：
- prototype "my-agent" 的 persona 字段更新为 "expert"

#### 用例 3：多字段同时更新

**前置条件**：prototype "my-agent" 存在

**命令**：
```bash
sumeru prototype update my-agent --model anthropic:claude-3 --persona expert
```

**后置条件**：

**text**：
```
Updated prototype my-agent
```

**副作用**：
- prototype "my-agent" 的 model 和 persona 字段都被更新

#### 用例 4：prototype 不存在

**前置条件**：prototype "nonexistent" 不存在

**命令**：
```bash
sumeru prototype update nonexistent --model openai:gpt-4
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "prototype_not_found" 的错误信息

**副作用**：无
