---
command: sumeru prototype add <name>
related_cases:
  - prototype-crud.test.yaml
---

# sumeru prototype add

## 描述

注册新的 prototype（指定 adapter、model、persona 组合）。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --model | string | 是 | - | Model registry 名称 |
| --adapter | string | 是 | - | Adapter 名称 |
| --persona | string | 否 | default | Persona 名称 |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常创建 prototype

**前置条件**：
- Model "openai:gpt-4" 存在
- Adapter "docker" 存在
- Persona "coder" 存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter docker --persona coder
```

**后置条件**：

**text**：
```
Created prototype my-agent
```

**json**：
```json
{
  "name": "my-agent"
}
```

**副作用**：
- prototype "my-agent" 出现在 `sumeru prototype list` 中

### 用例 2：重复名称

**前置条件**：prototype "my-agent" 已存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter docker
```

**后置条件**：

**行为**：API 使用 upsert 语义，已存在的 prototype 会被更新（200 OK），而非报错

### 用例 3：model 不存在

**前置条件**：Model "nonexistent:model" 不存在

**命令**：
```bash
sumeru prototype add my-agent --model nonexistent:model --adapter docker
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "model_not_found" 的错误信息

### 用例 4：adapter 不存在

**前置条件**：Adapter "nonexistent" 不存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "adapter_not_found" 的错误信息

### 用例 5：persona 不存在

**前置条件**：Persona "nonexistent" 不存在

**命令**：
```bash
sumeru prototype add my-agent --model openai:gpt-4 --adapter docker --persona nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "persona_not_found" 的错误信息
