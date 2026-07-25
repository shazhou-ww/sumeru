---
command: sumeru persona remove <name>
related_cases:
  - persona-crud.test.yaml
  - persona-prototype-reference-409.test.yaml
---

# sumeru persona remove

## 描述

删除 persona。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Persona 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常删除 persona

**前置条件**：persona "coder" 存在且未被 prototype 引用

**命令**：
```bash
sumeru persona remove coder
```

**后置条件**：

**text**：
```
Removed persona coder
```

**json**：
```json
{
  "message": "Removed persona coder"
}
```

**副作用**：
- persona "coder" 从 `sumeru persona list` 中消失

### 用例 2：被 prototype 引用（409）

**前置条件**：persona "coder" 存在，且被 prototype "my-agent" 引用

**命令**：
```bash
sumeru persona remove coder
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "persona_in_use" 的错误信息

**副作用**：
- persona "coder" 仍然存在

### 用例 3：persona 不存在

**前置条件**：persona "nonexistent" 不存在

**命令**：
```bash
sumeru persona remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "persona_not_found" 的错误信息

**副作用**：无
