---
command: sumeru model update <name>
related_cases:
  - model-crud.test.yaml
---

# sumeru model update

## 描述

更新 model 属性。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --provider | string | 否 | - | 新的 Provider 名称 |
| --model | string | 否 | - | 新的 API model 名称 |
| --context-window | string | 否 | - | 新的上下文窗口大小（如 128k, 1m） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：更新 context-window

**前置条件**：model "gpt-4" 存在，当前 contextWindow 为 128000

**命令**：
```bash
sumeru model update gpt-4 --context-window 256k
```

**后置条件**：

**text**：
```
Updated model gpt-4
```

**json**：
```json
{
  "name": "gpt-4"
}
```

**副作用**：
- model "gpt-4" 的 contextWindow 字段更新为 256000

### 用例 2：model 不存在

**前置条件**：model "nonexistent" 不存在

**命令**：
```bash
sumeru model update nonexistent --context-window 128k
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "model_not_found" 的错误信息

**副作用**：无
