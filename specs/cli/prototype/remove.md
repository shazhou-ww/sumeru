---
command: sumeru prototype remove <name>
related_cases:
  - prototype-crud.test.yaml
---

# sumeru prototype remove

## 描述

删除 prototype。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Prototype 名称（位置参数） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常删除 prototype

**前置条件**：prototype "my-agent" 存在且未被 session 引用

**命令**：
```bash
sumeru prototype remove my-agent
```

**后置条件**：

**text**：
```
Removed prototype my-agent
```

**json**：
```json
{
  "message": "Removed prototype my-agent"
}
```

**副作用**：
- prototype "my-agent" 从 `sumeru prototype list` 中消失

### 用例 2：被 session 引用

**前置条件**：prototype "my-agent" 存在，且有活跃 session 使用此 prototype

**命令**：
```bash
sumeru prototype remove my-agent
```

**后置条件**：

**行为**：可能返回 409 Conflict 错误，提示 prototype 正在使用中（具体行为需确认源码实现）

### 用例 3：prototype 不存在

**前置条件**：prototype "nonexistent" 不存在

**命令**：
```bash
sumeru prototype remove nonexistent
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "not found" 或 "prototype_not_found" 的错误信息

**副作用**：无
