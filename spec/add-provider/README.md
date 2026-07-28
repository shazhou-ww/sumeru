# Provider 完整 CRUD 生命周期

Provider 是 LLM 接入点配置（SQLite 实体）。管理 API endpoint、协议类型和密钥。

## Provider 字段

```json
{
  "name": "anthropic",
  "apiType": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "apiKey": "sk-xxx",
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:00:00.000Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | 唯一标识，来自 URL `:name` |
| apiType | "anthropic" \| "openai" | ✅ | API 协议类型 |
| baseUrl | string \| null | ❌ | 自定义 endpoint，null 用默认 |
| apiKey | string \| null | ❌ | API key，null 从环境取 |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /providers | 列出所有 |
| GET | /providers/:name | 单个详情 |
| PUT | /providers/:name | upsert（201 新建 / 200 替换） |
| DELETE | /providers/:name | 删除（204 / 404 / 409） |

PUT 使用 merge 语义 — 省略的字段保留现有值。

### 删除保护

删除 Provider 时若有 Model 引用它，返回 `409 provider_in_use`。

### 响应信封

```json
{ "type": "@sumeru/provider", "value": { ... } }
{ "type": "@sumeru/provider-list", "value": [ ... ] }
```

---

## Scenario: 列出所有 Provider

**When** `GET /providers`

**Then** 200，返回 `@sumeru/provider-list`

**Then** 每项包含 name、apiType、baseUrl（apiKey 脱敏）

---

## Scenario: 创建 Provider

**Given** Provider "openai" 不存在

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai \
  -H "Content-Type: application/json" \
  -d '{"apiType":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"sk-xxx"}'
```

**Then** 201 created
```json
{ "type": "@sumeru/provider", "value": { "name": "openai", "apiType": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-xxx" } }
```

---

## Scenario: 更新 Provider (merge)

**Given** Provider "openai" 已存在，baseUrl = "https://api.openai.com/v1"

**When**
```bash
curl -s -X PUT http://localhost:3000/providers/openai \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-yyy"}'
```

**Then** 200 updated（baseUrl 保留原值，apiKey 被替换）
```json
{ "type": "@sumeru/provider", "value": { "name": "openai", "apiType": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-yyy" } }
```

---

## Scenario: 删除 Provider

**When** `DELETE /providers/openai`

**Then** 204 No Content

**When** `GET /providers/openai`

**Then** 404 `provider_not_found`

---

## Scenario: 删除被引用的 Provider

**Given** Provider "openai" 被 Model "openai:gpt-4" 引用

**When** `DELETE /providers/openai`

**Then** 409 `provider_in_use`
```json
{ "type": "@sumeru/error", "value": { "code": "provider_in_use", "message": "Provider openai is referenced by 1 model(s)" } }
```

---

## Scenario: 获取不存在的 Provider

**When** `GET /providers/nonexistent`

**Then** 404 `provider_not_found`

---

# CLI 命令

## sumeru provider add

### 描述

注册新的 LLM provider。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --api-type | string | 是 | - | API 协议类型（openai 或 anthropic） |
| --base-url | string | 是 | - | Provider base URL |
| --api-key | string | 否 | - | API key |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：正常创建 provider

**前置条件**：provider "openai" 不存在

**命令**：
```bash
sumeru provider add openai --api-type openai --base-url https://api.openai.com/v1 --api-key sk-xxx
```

**后置条件**：

**text**：
```
Created provider openai
```

**json**：
```json
{
  "name": "openai"
}
```

**副作用**：
- provider "openai" 出现在 `sumeru provider list` 中

#### 用例 2：重复名称

**前置条件**：provider "openai" 已存在

**命令**：
```bash
sumeru provider add openai --api-type openai --base-url https://api.openai.com/v2
```

**后置条件**：

**行为**：API 使用 upsert 语义，已存在的 provider 会被更新（200 OK），而非报错

#### 用例 3：缺少 --api-type

**前置条件**：无

**命令**：
```bash
sumeru provider add openai --base-url https://api.openai.com/v1
```

**后置条件**：

**退出码**：非 0

**输出**：包含 usage 提示信息

**副作用**：无

#### 用例 4：无效的 --api-type

**前置条件**：无

**命令**：
```bash
sumeru provider add openai --api-type invalid --base-url https://api.openai.com/v1
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "Flag --api-type must be \"anthropic\" or \"openai\"" 的错误信息

**副作用**：无

---

## sumeru provider get

### 描述

获取 provider 详情。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：获取存在的 provider

**前置条件**：provider "openai" 存在

**命令**：
```bash
sumeru provider get openai
```

**后置条件**：

**text**：
```
Name: openai
Type: openai
URL: https://api.openai.com/v1
```

**json**：
```json
{
  "name": "openai",
  "apiType": "openai",
  "baseUrl": "https://api.openai.com/v1"
}
```

**注意**：json 输出中 apiKey 字段被脱敏或不包含

#### 用例 2：获取不存在的 provider

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru provider get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "provider_not_found" 的错误信息

**副作用**：无

---

## sumeru provider list

### 描述

列出所有已注册的 LLM provider。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

### 用例

#### 用例 1：正常列出 provider

**前置条件**：系统中存在至少一个 provider

**命令**：
```bash
sumeru provider list
```

**后置条件**：

**text**：
```
#  NAME       APITYPE     BASEURL
-  ---------  ----------  ----------------------------
1  openai     openai      https://api.openai.com/v1
2  anthropic  anthropic   https://api.anthropic.com
```

**json**：
```json
[
  {
    "name": "openai",
    "apiType": "openai",
    "baseUrl": "https://api.openai.com/v1"
  },
  {
    "name": "anthropic",
    "apiType": "anthropic",
    "baseUrl": "https://api.anthropic.com"
  }
]
```

#### 用例 2：空列表

**前置条件**：系统中没有 provider

**命令**：
```bash
sumeru provider list
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

## sumeru provider remove

### 描述

删除 provider。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：正常删除 provider

**前置条件**：provider "openai" 存在且未被 model 引用

**命令**：
```bash
sumeru provider remove openai
```

**后置条件**：

**text**：
```
Removed provider openai
```

**json**：
```json
{
  "message": "Removed provider openai"
}
```

**副作用**：
- provider "openai" 从 `sumeru provider list` 中消失

#### 用例 2：被 model 引用（409）

**前置条件**：provider "openai" 存在，且被 model "openai:gpt-4" 引用

**命令**：
```bash
sumeru provider remove openai
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "provider_in_use" 的错误信息

**副作用**：
- provider "openai" 仍然存在

#### 用例 3：provider 不存在

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru provider remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "provider_not_found" 的错误信息

**副作用**：无

---

## sumeru provider update

### 描述

更新 provider 属性。

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --api-type | string | 否 | - | 新的 API 协议类型（openai 或 anthropic） |
| --base-url | string | 否 | - | 新的 base URL |
| --api-key | string | 否 | - | 新的 API key |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

### 用例

#### 用例 1：更新 baseUrl

**前置条件**：provider "openai" 存在，当前 baseUrl 为 "https://api.openai.com/v1"

**命令**：
```bash
sumeru provider update openai --base-url https://api.openai.com/v2
```

**后置条件**：

**text**：
```
Updated provider openai
```

**json**：
```json
{
  "name": "openai"
}
```

**副作用**：
- provider "openai" 的 baseUrl 字段更新为 "https://api.openai.com/v2"

#### 用例 2：provider 不存在

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru provider update nonexistent --base-url https://api.example.com
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "provider_not_found" 的错误信息

**副作用**：无