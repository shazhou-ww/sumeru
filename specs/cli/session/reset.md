---
command: sumeru session reset <id>
related_cases:
  - session-commands.test.yaml
---

## 描述

重置 session 上下文（清空对话历史），可选指定新 persona。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `--persona` | string | 否 | — | 新的 persona 名称 |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常 reset

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session reset ses_XXX
```

**后置条件**  
- **text**: 输出包含 `reset ses_XXX` 确认信息
- **json**: 返回成功响应
- **副作用**: 对话历史被清空，adapter 调用 reset subcommand

---

### 用例 2：带 --persona

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session reset ses_XXX --persona new-persona
```

**后置条件**  
- **text**: 输出包含 `reset ses_XXX` 确认信息
- **json**: 返回成功响应
- **副作用**: 对话历史被清空，session 的 persona 被更新为 `new-persona`

---

### 用例 3：session 不存在

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session reset ses_FAKE
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0
