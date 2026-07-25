---
command: sumeru adapter list
group: adapter
description: 列出所有已注册的 adapter
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
  - name: --limit
    type: integer
    default: 20
    description: 每页返回数量上限
  - name: --offset
    type: integer
    default: 0
    description: 偏移量（分页起始位置）
---

## 描述

列出所有已注册的 adapter。Adapter 是 Sumeru 对接各种 AI agent CLI 的抽象层，每个 adapter 封装了一种特定的 agent 工具（如 claude-code、codex、hermes 等）。

## 参数表

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |
| `--limit` | integer | - | 20 | 每页返回数量上限 |
| `--offset` | integer | - | 0 | 偏移量（分页起始位置） |

## 用例

### 用例 1: 正常列出

- **Precondition**: 无特殊前置条件（Host 已运行）
- **Command**: `sumeru adapter list`
- **Postcondition**:
  - **text**: 输出为表格形式，包含 `sarsapa`、`hermes`、`claude-code`、`codex`、`cursor-agent` 等 adapter 条目
  - **json**: 返回数组，每个元素包含 `name`（adapter 名称）、`providerMode`（供给模式）、`credentialEnv`（所需凭证环境变量）等字段
  - **副作用**: 无

## 相关测试用例

- `adapter-list.test.yaml`
- `adapter-list-and-get.test.yaml`
