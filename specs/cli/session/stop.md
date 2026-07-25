---
command: sumeru session stop <id>
related_cases:
  - session-lifecycle.test.yaml
  - session-stop.test.yaml
  - error-paths.test.yaml
---

## 描述

停止正在运行的 session。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常停止

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态为 running

**命令**  
```bash
sumeru session stop ses_XXX
```

**后置条件**  
- **text**: 输出包含 `stopped` 或类似确认信息
- **json**: 返回更新后的 session 对象
- **副作用**: Session 状态从 running 变为 idle

---

### 用例 2：已 idle 时停止

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态已为 idle

**命令**  
```bash
sumeru session stop ses_XXX
```

**后置条件**  
- **text**: 输出包含 `session_already_idle` 错误信息
- **json**: 返回错误对象 `{"code": "session_already_idle", ...}`
- **副作用**: 无
- **退出码**: 非 0

---

### 用例 3：不存在的 session

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session stop ses_FAKE
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0
