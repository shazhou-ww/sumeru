---
command: sumeru model list
related_cases:
  - model-crud.test.yaml
---

# sumeru model list

## 描述

列出所有已注册的 model。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --provider | string | 否 | - | 按 provider 过滤 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

## 用例

### 用例 1：正常列出 model

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

### 用例 2：--provider 过滤

**前置条件**：系统中有多个 provider 的 model

**命令**：
```bash
sumeru model list --provider openai
```

**后置条件**：

**text**：只返回 provider 为 "openai" 的 model

**json**：只返回 provider 为 "openai" 的 model 数组

### 用例 3：空列表

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
