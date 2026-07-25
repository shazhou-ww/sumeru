---
command: sumeru prototype list
related_cases:
  - prototype-crud.test.yaml
---

# sumeru prototype list

## 描述

列出所有已注册的 prototype。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |
| --limit | number | 否 | 50 | 最大返回条数 |
| --offset | number | 否 | 0 | 跳过前 N 条 |

## 用例

### 用例 1：正常列出 prototype

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

### 用例 2：空列表

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

### 用例 3：分页

**前置条件**：系统中有 5 个 prototype

**命令**：
```bash
sumeru prototype list --limit 2
```

**后置条件**：

**text**：返回最多 2 条记录，并提示使用 `--offset` 查看更多

**json**：返回最多 2 个对象的数组

**副作用**：无
