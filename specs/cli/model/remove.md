---
command: sumeru model remove <name>
related_cases:
  - model-crud.test.yaml
---

# sumeru model remove

## 描述

删除 model。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常删除 model

**前置条件**：model "gpt-4" 存在且未被 prototype 引用

**命令**：
```bash
sumeru model remove gpt-4
```

**后置条件**：

**text**：
```
Removed model gpt-4
```

**json**：
```json
{
  "message": "Removed model gpt-4"
}
```

**副作用**：
- model "gpt-4" 从 `sumeru model list` 中消失

### 用例 2：被 prototype 引用

**前置条件**：model "gpt-4" 存在，且被 prototype "my-agent" 引用

**命令**：
```bash
sumeru model remove gpt-4
```

**后置条件**：

**行为**：可能返回 409 Conflict 错误，提示 model 正在使用中（具体行为需确认源码实现）

### 用例 3：model 不存在

**前置条件**：model "nonexistent" 不存在

**命令**：
```bash
sumeru model remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "model_not_found" 的错误信息

**副作用**：无
