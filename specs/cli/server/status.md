---
command: sumeru server status
group: server
description: 查询 Host 进程状态
parameters:
  - name: --format
    type: string
    values: [yaml, json, text, html]
    default: text
    description: 输出格式
  - name: --compact
    type: boolean
    default: false
    description: 紧凑输出（省略装饰性字段）
  - name: --quiet
    type: boolean
    default: false
    description: 静默模式（仅输出关键信息）
---

## 描述

查询当前 Host 进程的运行状态，包括是否在线、运行时长、以及活跃 session 数量等信息。

## 参数表

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |

## 用例

### 用例 1: Host 运行中

- **Precondition**: Host 进程正在运行（已通过 `sumeru server start` 启动）
- **Command**: `sumeru server status`
- **Postcondition**:
  - **text**: 输出包含 `running` 字样以及运行时间（uptime）
  - **json**: 返回对象包含字段 `status` 值为 `"running"`，以及 `uptime`、session 计数等信息
  - **副作用**: 无

### 用例 2: Host 未运行

- **Precondition**: Host 进程已停止（已执行 `sumeru server stop` 或从未启动）
- **Command**: `sumeru server status`
- **Postcondition**:
  - **text**: 输出包含 `stopped` 或 `not running` 字样
  - **json**: 返回对象中 `status` 值为 `"stopped"` 或 `"not_running"`
  - **副作用**: exit code 非 0（表示 Host 不在运行状态）

## 相关测试用例

- `server-status.test.yaml`
- `host-lifecycle.test.yaml`
