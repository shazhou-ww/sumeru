---
command: sumeru session snapshot <id> <name>
related_cases:
  - session-commands.test.yaml
  - snapshot-inherit-sarsapa.test.yaml
  - snapshot-inherit-hermes.test.yaml
  - snapshot-inherit-claude-code.test.yaml
  - snapshot-inherit-codex.test.yaml
  - snapshot-inherit-cursor-agent.test.yaml
---

## 描述

将 session 当前容器状态快照为新的 prototype 镜像。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | — | Session ID（位置参数） |
| `name` | string | 是 | — | 新 prototype 名称（位置参数） |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常快照

**前提条件**  
存在 ID 为 `ses_XXX` 的 session

**命令**  
```bash
sumeru session snapshot ses_XXX my-new-proto
```

**后置条件**  
- **text**: 输出包含 `Snapshot created`、`Name: my-new-proto`、`Image: sumeru/my-new-proto:dev` 等信息
- **json**: 返回快照信息对象
- **副作用**: Docker image `sumeru/my-new-proto:dev` 被创建，可用于后续 prototype add

---

### 用例 2：session 不存在

**前提条件**  
ID 为 `ses_FAKE` 的 session 不存在

**命令**  
```bash
sumeru session snapshot ses_FAKE my-proto
```

**后置条件**  
- **text**: 输出包含 `session_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "session_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0
