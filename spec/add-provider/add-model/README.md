# Model 完整 CRUD 生命周期

Model 是 LLM 模型注册条目（SQLite 实体），拥有全局唯一的 ID（如 `claude-sonnet-4`），通过 `provider` 字段关联到 Provider。

## Model 字段

```json
{
  "name": "claude-sonnet-4",
  "provider": "copilot",
  "model": "claude-sonnet-4-20250514",
  "contextWindow": 200000,
  "toolUse": true,
  "streaming": true,
  "metadata": null,
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | Provider 内的模型名，来自 URL `:modelName` |
| provider | string | ✅ | 引用 Provider.name（来自 URL `:name`） |
| model | string | ✅ | 实际模型名称（发送给 API 的） |
| contextWindow | number \| null | ❌ | 上下文窗口大小 |
| toolUse | boolean | ❌ | 是否支持 tool use（默认 true） |
| streaming | boolean | ❌ | 是否支持 streaming（默认 true） |
| metadata | object \| null | ❌ | 自定义元数据 |

### 模型 ID

- Prototype 的 `model` 字段、Session model override 字符串均使用模型 ID 格式
- SQLite 内部 `models.id` 列存储全局唯一的模型 ID
- CLI 命令参数使用同一格式，如 `sumeru model get copilot:claude-sonnet-4`

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /models | 列出所有 Provider 下的模型（便捷路由） |
| GET | /providers/:name/models | 列出指定 Provider 下的模型 |
| GET | /providers/:name/models/:modelName | 单个详情 |
| PUT | /providers/:name/models/:modelName | upsert（201 新建 / 200 更新） |
| DELETE | /providers/:name/models/:modelName | 删除（204 / 404） |

PUT 使用 merge 语义 — 省略的字段保留现有值。新建时 `model`（API 模型字符串）必填。

### 引用校验

upsert 时 URL 中的 `:name`（Provider）必须存在，否则返回 `404 provider_not_found`。

### 响应信封

```json
{ "type": "@sumeru/model", "value": { ... } }
{ "type": "@sumeru/model-list", "value": [ ... ] }
```

---

## Scenario: 列出所有 Model

**When** `GET /models`

**Then** 200，返回 `@sumeru/model-list`

**Then** 每项包含 name、provider、model、contextWindow

---

## Scenario: 创建 Model

**Given** Provider "openai" 已存在

**Given** Model "openai:gpt-4" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai/models/gpt-4 \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4-turbo-preview","contextWindow":128000}'
```

**Then** 201 created
```json
{ "type": "@sumeru/model", "value": { "name": "gpt-4", "provider": "openai", "model": "gpt-4-turbo-preview", "contextWindow": 128000, "toolUse": true, "streaming": true } }
```

---

## Scenario: 更新 Model (merge)

**Given** Model "openai:gpt-4" 已存在，contextWindow = 128000

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai/models/gpt-4 \
  -H "Content-Type: application/json" \
  -d '{"toolUse":false}'
```

**Then** 200 updated（contextWindow 保留原值，toolUse 被替换）
```json
{ "type": "@sumeru/model", "value": { "name": "gpt-4", "provider": "openai", "model": "gpt-4-turbo-preview", "contextWindow": 128000, "toolUse": false, "streaming": true } }
```

---

## Scenario: 删除 Model

**When** `DELETE /providers/openai/models/gpt-4`

**Then** 204 No Content

**When** `GET /providers/openai/models/gpt-4`

**Then** 404 `model_not_found`

---

## Scenario: 获取不存在的 Model

**When** `GET /providers/openai/models/nonexistent`

**Then** 404 `model_not_found`

---

## Scenario: 在 Provider 不存在时创建 Model

**Given** Provider "nonexistent" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/nonexistent/models/gpt-4 \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4"}'
```

**Then** 404 `provider_not_found`
```json
{ "type": "@sumeru/error", "value": { "code": "provider_not_found", "message": "Provider not found" } }
```

---

## CLI: sumeru model add

### 描述

注册新 model（关联到 provider）。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --provider | string | 是 | - | Provider 名称 |
| --model | string | 是 | - | API model 名称（发送给 API 的实际模型名） |
| --context-window | string | 否 | - | 上下文窗口大小（如 128k, 1m） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：正常创建 model

**前置条件**：provider "openai" 存在

**命令**：
```bash
sumeru model add gpt-4 --provider openai --model gpt-4-turbo-preview --context-window 128k
```

**后置条件**：

**text**：
```
Created model gpt-4
```

**json**：
```json
{
  "name": "gpt-4"
}
```

**副作用**：
- model "gpt-4" 出现在 `sumeru model list` 中

#### 用例 2：provider 不存在

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru model add gpt-4 --provider nonexistent --model gpt-4
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "provider_not_found" 的错误信息

#### 用例 3：缺少 --provider 或 --model

**前置条件**：无

**命令**：
```bash
sumeru model add gpt-4 --provider openai
```

**后置条件**：

**退出码**：非 0

**输出**：包含 usage 提示信息

**副作用**：无

---

## CLI: sumeru model get

### 描述

获取 model 详情。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：获取存在的 model

**前置条件**：model "gpt-4" 存在

**命令**：
```bash
sumeru model get gpt-4
```

**后置条件**：

**text**：
```
Name: gpt-4
Provider: openai
Model: gpt-4-turbo-preview
Context: 128000
```

**json**：
```json
{
  "name": "gpt-4",
  "provider": "openai",
  "model": "gpt-4-turbo-preview",
  "contextWindow": 128000
}
```

#### 用例 2：获取不存在的 model

**前置条件**：model "nonexistent" 不存在

**命令**：
```bash
sumeru model get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "model_not_found" 的错误信息

**副作用**：无

---

## CLI: sumeru model list

### 描述

列出所有已注册的 model。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --provider | string | 否 | - | 按 provider 过滤 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

### 用例

#### 用例 1：正常列出 model

**前置条件**：系统中存在至少一个 model

**命令**：
```bash
sumeru model list
```

**后置条件**：

**text**：
```
#  NAME        PROVIDER   MODEL                CONTEXTWINDOW
-  ----------  ---------  -------------------  -------------
1  gpt-4       openai     gpt-4-turbo-preview  128000
2  claude-3    anthropic  claude-3-sonnet      200000
```

**json**：
```json
[
  {
    "name": "gpt-4",
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "contextWindow": 128000
  },
  {
    "name": "claude-3",
    "provider": "anthropic",
    "model": "claude-3-sonnet",
    "contextWindow": 200000
  }
]
```

#### 用例 2：--provider 过滤

**前置条件**：系统中有多个 provider 的 model

**命令**：
```bash
sumeru model list --provider openai
```

**后置条件**：

**text**：只返回 provider 为 "openai" 的 model

**json**：只返回 provider 为 "openai" 的 model 数组

#### 用例 3：空列表

**前置条件**：系统中没有 model

**命令**：
```bash
sumeru model list
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

**副作用**：无

---

## CLI: sumeru model remove

### 描述

删除 model。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：正常删除 model

**前置条件**：model "gpt-4" 存在且未被 prototype 引用

**命令**：
```bash
sumeru model remove gpt-4
```

**后置条件**：

**text**：
```
Removed model gpt-4
```

**json**：
```json
{
  "message": "Removed model gpt-4"
}
```

**副作用**：
- model "gpt-4" 从 `sumeru model list` 中消失

#### 用例 2：被 prototype 引用

**前置条件**：model "gpt-4" 存在，且被 prototype "my-agent" 引用

**命令**：
```bash
sumeru model remove gpt-4
```

**后置条件**：

**行为**：可能返回 409 Conflict 错误，提示 model 正在使用中（具体行为需确认源码实现）

#### 用例 3：model 不存在

**前置条件**：model "nonexistent" 不存在

**命令**：
```bash
sumeru model remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "model_not_found" 的错误信息

**副作用**：无

---

## CLI: sumeru model update

### 描述

更新 model 属性。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --provider | string | 否 | - | 新的 Provider 名称 |
| --model | string | 否 | - | 新的 API model 名称 |
| --context-window | string | 否 | - | 新的上下文窗口大小（如 128k, 1m） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：更新 context-window

**前置条件**：model "gpt-4" 存在，当前 contextWindow 为 128000

**命令**：
```bash
sumeru model update gpt-4 --context-window 256k
```

**后置条件**：

**text**：
```
Updated model gpt-4
```

**json**：
```json
{
  "name": "gpt-4"
}
```

**副作用**：
- model "gpt-4" 的 contextWindow 字段更新为 256000

#### 用例 2：model 不存在

**前置条件**：model "nonexistent" 不存在

**命令**：
```bash
sumeru model update nonexistent --context-window 128k
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "model_not_found" 的错误信息

**副作用**：无
