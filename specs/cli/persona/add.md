---
command: sumeru persona add <name>
related_cases:
  - persona-crud-lifecycle.test.yaml
  - persona-crud.test.yaml
---

# sumeru persona add

## 描述

创建 persona（系统提示词）。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Persona 名称（位置参数） |
| --instructions | string | 是 | - | 系统提示词文本 |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常创建 persona

**前置条件**：persona "coder" 不存在

**命令**：
```bash
sumeru persona add coder --instructions "You are a professional software engineer."
```

**后置条件**：

**text**：
```
Created persona coder
```

**json**：
```json
{
  "name": "coder"
}
```

**副作用**：
- persona "coder" 出现在 `sumeru persona list` 中

### 用例 2：重复名称

**前置条件**：persona "coder" 已存在

**命令**：
```bash
sumeru persona add coder --instructions "New instructions"
```

**后置条件**：

**行为**：API 使用 upsert 语义，已存在的 persona 会被更新（200 OK），而非报错

### 用例 3：缺少 --instructions

**前置条件**：无

**命令**：
```bash
sumeru persona add coder
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "--instructions is required" 的提示信息

**副作用**：无
