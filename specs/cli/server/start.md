---
command: sumeru server start
group: server
description: 后台启动 Host 进程
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

在后台启动 Host 进程。Host 是 Sumeru 的核心服务进程，负责管理 session 生命周期、adapter 调度、以及 CAS 存储。

## 参数表

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |

## 用例

### 用例 1: 正常启动

- **Precondition**: Host 进程未运行
- **Command**: `sumeru server start`
- **Postcondition**:
  - **text**: 输出包含 `started` 字样
  - **json**: 返回对象包含启动确认信息
  - **副作用**: 执行 `sumeru server status` 返回 `status: running`

### 用例 2: 已在运行时启动

- **Precondition**: Host 进程已在运行中
- **Command**: `sumeru server start`
- **Postcondition**:
  - **text**: 输出包含 `already running` 或类似提示
  - **json**: 返回对象包含 `already_running` 状态信息
  - **副作用**: exit code 为 0（非错误状态）；Host 进程保持正常运行不受影响

## 相关测试用例

- `host-lifecycle.test.yaml`
