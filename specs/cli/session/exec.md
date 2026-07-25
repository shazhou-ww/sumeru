---
command: sumeru session exec <id> -- <command...>
related_cases:
  - session-commands.test.yaml
---

## 描述

在 session 的 Docker 容器内执行 shell 命令。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `command...` | string | 是 | — | 要执行的命令（位置参数，`--` 后） |

## 用例

### 用例 1：正常执行

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态为 idle

**命令**  
```bash
sumeru session exec ses_XXX -- ls -la
```

**后置条件**  
- **输出**: 命令的 stdout
- **退出码**: 等于命令的 exit code
- **副作用**: 无

---

### 用例 2：session 不存在

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session exec ses_FAKE -- echo test
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0

---

### 用例 3：长时间命令

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session exec ses_XXX -- sleep 60
```

**后置条件**  
- **行为**: 等待命令执行完成或超时
- **退出码**: 若超时则非 0
