---
command: sumeru session turns <id>
related_cases:
  - turns-list.test.yaml
  - turns-pagination.test.yaml
  - turns-filter-by-tool.test.yaml
  - turns-filter-by-role.test.yaml
  - turns-filter-by-time.test.yaml
  - turns-watch-realtime.test.yaml
  - turns-show-tool-calls.test.yaml
  - turn-discriminated-union.test.yaml
---

## 描述

列出 session 的所有对话轮次（turns），支持多种过滤和实时订阅。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `--after` | number | 否 | — | 只返回 ID > N 的 turns（游标分页） |
| `-w, --watch` | boolean | 否 | false | 实时流式输出新 turn |
| `--system` | boolean | 否 | false | 包含 system prompt |
| `--limit` | number | 否 | 50 | 返回条数上限 |
| `--offset` | number | 否 | 0 | 跳过前 N 条 |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常列出

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，已有若干 turns

**命令**  
```bash
sumeru session turns ses_XXX
```

**后置条件**  
- **text**: 输出包含 `[user]`、`[assistant]`、`[tool]` 角色标记
- **json**: 返回 turns 数组，每个元素包含 role、content、timestamp 等字段
- **副作用**: 无

---

### 用例 2：空 turns

**前提条件**  
存在 ID 为 `ses_XXX` 的新 session，无任何消息

**命令**  
```bash
sumeru session turns ses_XXX
```

**后置条件**  
- **text**: 无输出或提示空
- **json**: 返回空数组 `[]`
- **副作用**: 无

---

### 用例 3：--after N

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，已有多个 turns

**命令**  
```bash
sumeru session turns ses_XXX --after 5
```

**后置条件**  
- **text**: 只显示 ID > 5 的 turns
- **json**: 数组中所有元素的 ID 均 > 5
- **副作用**: 无

---

### 用例 4：--watch

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session turns ses_XXX --watch
```

**后置条件**  
- **行为**: 持续输出新 turn（实时流式）
- **副作用**: 无（仅订阅）

---

### 用例 5：tool call 显示

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，assistant turn 包含 tool call

**命令**  
```bash
sumeru session turns ses_XXX
```

**后置条件**  
- **text**: Tool call 显示为 `→ name(args)` 格式
- **json**: Turn 对象中包含 tool_calls 字段
- **副作用**: 无

---

### 用例 6：discriminated union

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，包含 assistant 和 tool turns

**命令**  
```bash
sumeru session turns ses_XXX --format json
```

**后置条件**  
- **json**: Assistant turn 和 tool turn 具有不同的结构（discriminated union）
- **副作用**: 无
