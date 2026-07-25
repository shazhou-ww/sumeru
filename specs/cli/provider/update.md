---
command: sumeru provider update <name>
related_cases:
  - provider-crud.test.yaml
---

# sumeru provider update

## 描述

更新 provider 属性。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --api-type | string | 否 | - | 新的 API 协议类型（openai 或 anthropic） |
| --base-url | string | 否 | - | 新的 base URL |
| --api-key | string | 否 | - | 新的 API key |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：更新 baseUrl

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

### 用例 2：provider 不存在

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru provider update nonexistent --base-url https://api.example.com
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "provider_not_found" 的错误信息

**副作用**：无
