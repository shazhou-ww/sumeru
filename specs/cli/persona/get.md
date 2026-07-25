---
command: sumeru persona get <name>
related_cases:
  - persona-crud-lifecycle.test.yaml
  - persona-crud.test.yaml
---

# sumeru persona get

## 描述

获取 persona 详情。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Persona 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：获取存在的 persona

**前置条件**：persona "coder" 存在

**命令**：
```bash
sumeru persona get coder
```

**后置条件**：

**text**：
```
Name: coder
Instructions: You are a professional software engineer.
```

**json**：
```json
{
  "name": "coder",
  "instructions": "You are a professional software engineer."
}
```

### 用例 2：获取不存在的 persona

**前置条件**：persona "nonexistent" 不存在

**命令**：
```bash
sumeru persona get nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "persona_not_found" 的错误信息

**副作用**：无
