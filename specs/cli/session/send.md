---
command: sumeru session send <id> <message>
related_cases:
  - session-lifecycle.test.yaml
  - session-resume.test.yaml
---

## 描述

向 session 发送消息，实现多轮对话。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `message` | string | 是 | — | 消息内容（位置参数） |
| `--model` | string | 否 | — | 热切换模型 |
| `--env` | string | 否 | — | 环境变量，格式 `KEY=VALUE`，可重复 |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常发送

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态为 idle

**命令**  
```bash
sumeru session send ses_XXX "请执行任务 Y"
```

**后置条件**  
- **text**: 输出包含 `accepted message msg_XXX` 确认信息
- **json**: 返回消息对象
- **副作用**: Session 状态从 idle 变为 running，产生新 turn

---

### 用例 2：session 不存在

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session send ses_FAKE "消息内容"
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0

---

### 用例 3：session running 时发送

**前提条件**  
存在 ID 为 `ses_XXX` 的 session，状态为 running

**命令**  
```bash
sumeru session send ses_XXX "追加消息"
```

**后置条件**  
- **行为**: 取决于实现——FIFO 排队或拒绝（返回 `session_busy` 错误）
- **副作用**: 若排队则消息等待处理；若拒绝则无副作用
- **退出码**: 若拒绝则非 0
