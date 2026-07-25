---
command: sumeru provider list
related_cases:
  - provider-crud.test.yaml
---

# sumeru provider list

## 描述

列出所有已注册的 LLM provider。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

## 用例

### 用例 1：正常列出 provider

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

### 用例 2：空列表

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
