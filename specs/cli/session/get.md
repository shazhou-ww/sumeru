---
command: sumeru session get <id>
related_cases:
  - session-lifecycle.test.yaml
  - session-get-by-id.test.yaml
---

## 描述

获取指定 session 的详细信息。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：存在的 session

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session get ses_XXX
```

**后置条件**  
- **text**: 输出包含 ID、Prototype、Status、Task、Project 等字段
- **json**: 返回完整 session 对象，包含所有字段
- **副作用**: 无

---

### 用例 2：不存在的 session

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session get ses_FAKE
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0
