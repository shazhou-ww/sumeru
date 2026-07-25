---
command: sumeru session remove <id>
related_cases:
  - session-lifecycle.test.yaml
  - session-delete.test.yaml
  - session-delete-running.test.yaml
---

## 描述

删除 session 及其关联资源（Docker 容器等）。

**别名**: `rm` 是 `remove` 的别名，两者功能完全相同。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常删除（idle session）

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态为 idle

**命令**  
```bash
sumeru session remove ses_XXX
# 或使用别名
sumeru session rm ses_XXX
```

**后置条件**  
- **text**: 输出包含 `Removed` 确认信息
- **json**: 返回成功响应
- **副作用**: Session 从列表中消失，Docker 容器被移除

---

### 用例 2：删除 running session

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态为 running

**命令**  
```bash
sumeru session remove ses_XXX
```

**后置条件**  
- **text**: 输出包含 `Removed` 确认信息
- **json**: 返回成功响应
- **副作用**: 强制停止容器并删除，Session 从列表中消失

---

### 用例 3：不存在的 session

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session remove ses_FAKE
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0
