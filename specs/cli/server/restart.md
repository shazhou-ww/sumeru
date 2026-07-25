---
command: sumeru server restart
group: server
description: 重启 Host 进程（先 stop 再 start）
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

重启 Host 进程，等效于先执行 `sumeru server stop` 再执行 `sumeru server start`。重启过程中，现有 session 状态会被保留，重启后可通过 resume 恢复。

## 参数表

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |

## 用例

### 用例 1: 正常重启

- **Precondition**: Host 进程正在运行
- **Command**: `sumeru server restart`
- **Postcondition**:
  - **text**: 输出包含 `restarted` 字样
  - **json**: 返回对象包含重启确认信息
  - **副作用**:
    - 执行 `sumeru server status` 返回 `status: running`
    - 现有 session 状态保留（可通过 `sumeru session get` 查询）

### 用例 2: 未运行时重启

- **Precondition**: Host 进程未在运行
- **Command**: `sumeru server restart`
- **Postcondition**:
  - **text**: 输出包含启动成功信息（等效 `server start`）
  - **json**: 返回对象包含启动确认信息
  - **副作用**: 执行 `sumeru server status` 返回 `status: running`

## 相关测试用例

- `host-lifecycle.test.yaml`
- `resume-after-restart.test.yaml`
