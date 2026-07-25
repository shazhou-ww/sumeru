---
command: sumeru prototype update <name>
related_cases:
  - prototype-update.test.yaml
---

# sumeru prototype update

## 描述

更新已有 prototype 的属性（model/adapter/persona）。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --model | string | 否 | - | 新的 Model registry 名称 |
| --adapter | string | 否 | - | 新的 Adapter 名称 |
| --persona | string | 否 | - | 新的 Persona 名称 |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：更新 model

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

### 用例 2：更新 persona

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

### 用例 3：多字段同时更新

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

### 用例 4：prototype 不存在

**前置条件**：prototype "nonexistent" 不存在

**命令**：
```bash
sumeru prototype update nonexistent --model openai:gpt-4
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "prototype_not_found" 的错误信息

**副作用**：无
