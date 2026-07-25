---
command: sumeru provider remove <name>
related_cases:
  - provider-crud.test.yaml
  - provider-in-use-409.test.yaml
---

# sumeru provider remove

## 描述

删除 provider。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Provider 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常删除 provider

**前置条件**：provider "openai" 存在且未被 model 引用

**命令**：
```bash
sumeru provider remove openai
```

**后置条件**：

**text**：
```
Removed provider openai
```

**json**：
```json
{
  "message": "Removed provider openai"
}
```

**副作用**：
- provider "openai" 从 `sumeru provider list` 中消失

### 用例 2：被 model 引用（409）

**前置条件**：provider "openai" 存在，且被 model "openai:gpt-4" 引用

**命令**：
```bash
sumeru provider remove openai
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "provider_in_use" 的错误信息

**副作用**：
- provider "openai" 仍然存在

### 用例 3：provider 不存在

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru provider remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "provider_not_found" 的错误信息

**副作用**：无
