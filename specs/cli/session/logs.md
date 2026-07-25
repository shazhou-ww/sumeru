---
command: sumeru session logs <id>
related_cases: []
---

## 描述

查看或流式订阅 session 的事件日志（SSE）。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `-f, --follow` | boolean | 否 | false | 持续输出新事件（SSE 流） |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：查看历史日志

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，已有若干事件

**命令**  
```bash
sumeru session logs ses_XXX
```

**后置条件**  
- **text**: 输出已有事件（turn、heartbeat、exit 等）
- **json**: 返回事件数组
- **副作用**: 无

---

### 用例 2：--follow

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session logs ses_XXX --follow
```

**后置条件**  
- **行为**: 持续输出新事件（SSE 流）
- **副作用**: 无（仅订阅）

---

### 用例 3：session 不存在

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session logs ses_FAKE
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0
