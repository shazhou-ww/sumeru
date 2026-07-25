---
command: sumeru provider add <name>
related_cases:
  - provider-crud.test.yaml
---

# sumeru provider add

## 描述

注册新的 LLM provider。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --api-type | string | 是 | - | API 协议类型（openai 或 anthropic） |
| --base-url | string | 是 | - | Provider base URL |
| --api-key | string | 否 | - | API key |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常创建 provider

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

### 用例 2：重复名称

**前置条件**：provider "openai" 已存在

**命令**：
```bash
sumeru provider add openai --api-type openai --base-url https://api.openai.com/v2
```

**后置条件**：

**行为**：API 使用 upsert 语义，已存在的 provider 会被更新（200 OK），而非报错

### 用例 3：缺少 --api-type

**前置条件**：无

**命令**：
```bash
sumeru provider add openai --base-url https://api.openai.com/v1
```

**后置条件**：

**退出码**：非 0

**输出**：包含 usage 提示信息

**副作用**：无

### 用例 4：无效的 --api-type

**前置条件**：无

**命令**：
```bash
sumeru provider add openai --api-type invalid --base-url https://api.openai.com/v1
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "Flag --api-type must be \"anthropic\" or \"openai\"" 的错误信息

**副作用**：无
