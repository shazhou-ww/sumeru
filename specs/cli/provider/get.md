---
command: sumeru provider get <name>
related_cases:
  - provider-crud.test.yaml
---

# sumeru provider get

## 描述

获取 provider 详情。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：获取存在的 provider

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

### 用例 2：获取不存在的 provider

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru provider get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "provider_not_found" 的错误信息

**副作用**：无
