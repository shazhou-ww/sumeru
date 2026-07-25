---
command: sumeru server stop
group: server
description: 停止正在运行的 Host 进程
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

停止当前正在运行的 Host 进程。停止后，所有正在执行的 session 将被中断，但 session 数据会保留在 CAS 存储中。

## 参数表

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |

## 用例

### 用例 1: 正常停止

- **Precondition**: Host 进程正在运行
- **Command**: `sumeru server stop`
- **Postcondition**:
  - **text**: 输出包含 `stopped` 字样
  - **json**: 返回对象包含停止确认信息
  - **副作用**: 执行 `sumeru server status` 返回 `status: stopped` 或 `not_running`

### 用例 2: 未运行时停止

- **Precondition**: Host 进程未在运行
- **Command**: `sumeru server stop`
- **Postcondition**:
  - **text**: 输出包含 `not running` 或类似提示
  - **json**: 返回对象包含 `not_running` 状态信息
  - **副作用**: 无（幂等操作）

## 相关测试用例

- `host-lifecycle.test.yaml`
