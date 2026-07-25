---
command: sumeru model get <name>
related_cases:
  - model-crud.test.yaml
---

# sumeru model get

## 描述

获取 model 详情。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：获取存在的 model

**前置条件**：model "gpt-4" 存在

**命令**：
```bash
sumeru model get gpt-4
```

**后置条件**：

**text**：
```
Name: gpt-4
Provider: openai
Model: gpt-4-turbo-preview
Context: 128000
```

**json**：
```json
{
  "name": "gpt-4",
  "provider": "openai",
  "model": "gpt-4-turbo-preview",
  "contextWindow": 128000
}
```

### 用例 2：获取不存在的 model

**前置条件**：model "nonexistent" 不存在

**命令**：
```bash
sumeru model get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "model_not_found" 的错误信息

**副作用**：无
