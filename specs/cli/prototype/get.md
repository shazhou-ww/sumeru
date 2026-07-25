---
command: sumeru prototype get <name>
related_cases:
  - prototype-crud.test.yaml
---

# sumeru prototype get

## 描述

获取指定 prototype 的详细信息。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：获取存在的 prototype

**前置条件**：prototype "my-agent" 存在

**命令**：
```bash
sumeru prototype get my-agent
```

**后置条件**：

**text**：
```
Name: my-agent
Adapter: docker
Model: openai:gpt-4
Persona: coder
```

**json**：
```json
{
  "name": "my-agent",
  "adapter": "docker",
  "model": "openai:gpt-4",
  "persona": "coder"
}
```

### 用例 2：获取不存在的 prototype

**前置条件**：prototype "nonexistent" 不存在

**命令**：
```bash
sumeru prototype get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "prototype_not_found" 的错误信息

**副作用**：无
