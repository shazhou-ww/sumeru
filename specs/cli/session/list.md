---
command: sumeru session list
related_cases:
  - session-lifecycle.test.yaml
  - session-list-pagination.test.yaml
---

## 描述

列出所有 session，按创建时间倒序排列。支持分页和多种输出格式。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |
| `--limit` | number | 否 | 50 | 返回条数上限 |
| `--offset` | number | 否 | 0 | 跳过前 N 条 |

## 用例

### 用例 1：正常列出

**前提条件**  
系统中存在若干 session

**命令**  
```bash
sumeru session list
```

**后置条件**  
- **text**: 输出表格，包含 ID、PROTOTYPE、STATUS、TASK 列
- **json**: 返回数组，每个元素为 session 对象
- **副作用**: 无

---

### 用例 2：空列表

**前提条件**  
系统中无任何 session

**命令**  
```bash
sumeru session list
```

**后置条件**  
- **text**: 输出 `(empty)` 或类似提示
- **json**: 返回空数组 `[]`
- **副作用**: 无

---

### 用例 3：分页 limit

**前提条件**  
系统中存在 3 个以上 session

**命令**  
```bash
sumeru session list --limit 2
```

**后置条件**  
- **text**: 表格最多显示 2 行数据
- **json**: 数组长度 ≤ 2
- **副作用**: 无

---

### 用例 4：分页 offset

**前提条件**  
系统中存在 3 个以上 session

**命令**  
```bash
sumeru session list --offset 2
```

**后置条件**  
- **text**: 跳过前 2 条，从第 3 条开始显示
- **json**: 返回跳过前 2 条后的结果
- **副作用**: 无
