---
command: sumeru persona list
related_cases:
  - persona-crud-lifecycle.test.yaml
  - persona-crud.test.yaml
---

# sumeru persona list

## 描述

列出所有 persona。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

## 用例

### 用例 1：正常列出 persona

**前置条件**：系统中存在至少一个 persona

**命令**：
```bash
sumeru persona list
```

**后置条件**：

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

### 用例 2：空列表

**前置条件**：系统中没有 persona

**命令**：
```bash
sumeru persona list
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
