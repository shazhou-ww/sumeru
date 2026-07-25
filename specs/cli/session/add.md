---
command: sumeru session add <prototype>
related_cases:
  - session-lifecycle.test.yaml
  - session-create-no-task.test.yaml
  - session-with-project.test.yaml
  - error-paths.test.yaml
  - invalid-project-path-400.test.yaml
---

## 描述

创建新 session。根据 prototype 找到 adapter 和 model，在 Docker 中启动容器。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `prototype` | string | 是 | — | Prototype 名称（位置参数） |
| `--task` | string | 否 | — | 初始任务消息 |
| `--project` | string | 否 | — | 项目目录路径 |
| `--skip-reset` | boolean | 否 | false | 跳过 reset 步骤（用于 snapshot 继承场景） |
| `--env` | string | 否 | — | 环境变量，格式 `KEY=VALUE`，可重复 |
| `--format` | string | 否 | text | 输出格式：`text` / `json` / `yaml` |
| `--compact` | boolean | 否 | false | 紧凑输出（JSON/YAML） |
| `--quiet` | boolean | 否 | false | 仅输出必要信息 |

## 用例

### 用例 1：正常创建（带 task）

**前提条件**  
指定的 prototype 存在

**命令**  
```bash
sumeru session add <prototype> --task "执行任务 X"
```

**后置条件**  
- **text**: 输出 `Created session ses_XXX`
- **json**: `value.status = "queued"`
- **副作用**: Session 被创建，Docker 容器启动，状态为 running

---

### 用例 2：正常创建（无 task）

**前提条件**  
指定的 prototype 存在

**命令**  
```bash
sumeru session add <prototype>
```

**后置条件**  
- **text**: 输出 `Created session ses_XXX`
- **json**: `value.status = "idle"`
- **副作用**: Session 被创建，Docker 容器启动，状态为 idle

---

### 用例 3：带 project

**前提条件**  
指定的 prototype 存在，`--project` 路径合法

**命令**  
```bash
sumeru session add <prototype> --project /path/to/project
```

**后置条件**  
- **text**: 输出 `Created session ses_XXX`
- **json**: `value.project = "/path/to/project"`
- **副作用**: Session 被创建，容器内 `/workspace` 挂载到指定路径

---

### 用例 4：prototype 不存在

**前提条件**  
指定的 prototype 不存在

**命令**  
```bash
sumeru session add nonexistent-prototype
```

**后置条件**  
- **text**: 输出包含 `prototype_not_found` 错误信息
- **json**: 返回错误对象 `{"code": "prototype_not_found", ...}`
- **副作用**: 无
- **退出码**: 非 0

---

### 用例 5：project 路径越界

**前提条件**  
指定的 prototype 存在

**命令**  
```bash
sumeru session add <prototype> --project /etc/passwd
```

**后置条件**  
- **text**: 输出错误信息
- **json**: 返回错误对象
- **副作用**: 无
- **退出码**: 非 0

---

### 用例 6：--skip-reset

**前提条件**  
指定的 prototype 存在，用于 snapshot 继承场景

**命令**  
```bash
sumeru session add <prototype> --skip-reset
```

**后置条件**  
- **text**: 输出 `Created session ses_XXX`
- **json**: 返回 session 对象
- **副作用**: Session 被创建，跳过 adapter reset 步骤
