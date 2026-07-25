---
command: sumeru adapter models <name>
group: adapter
description: 列出指定 adapter 的内置模型
parameters:
  - name: name
    type: string
    required: true
    position: 1
    description: adapter 名称（如 cursor-agent, hermes）
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

列出指定 adapter 注册时声明的内置模型列表。并非所有 adapter 都有内置模型——有些 adapter（如 hermes）允许用户在运行时指定任意模型，而有些 adapter（如 cursor-agent）则绑定了特定的内置模型集合。

## 参数表

| 参数 | 类型 | 必填 | 位置 | 默认值 | 说明 |
|------|------|------|------|--------|------|
| `name` | string | 是 | 1 | - | adapter 名称 |
| `--format` | string | 否 | - | text | 输出格式（yaml, json, text, html） |
| `--compact` | boolean | 否 | - | false | 紧凑输出 |
| `--quiet` | boolean | 否 | - | false | 静默模式 |
| `--limit` | integer | 否 | - | 20 | 每页返回数量上限 |
| `--offset` | integer | 否 | - | 0 | 偏移量（分页起始位置） |

## 用例

### 用例 1: 有内置模型的 adapter

- **Precondition**: 指定的 adapter 已注册且声明了内置模型（如 `name=cursor-agent`）
- **Command**: `sumeru adapter models cursor-agent`
- **Postcondition**:
  - **text**: 输出模型列表，包含模型名称和相关信息
  - **json**: 返回模型数组，每个元素包含模型标识符和描述
  - **副作用**: 无

### 用例 2: 无内置模型的 adapter

- **Precondition**: 指定的 adapter 已注册但未声明内置模型（如 `name=hermes`）
- **Command**: `sumeru adapter models hermes`
- **Postcondition**:
  - **text**: 输出空列表或提示"无内置模型"
  - **json**: 返回空数组 `[]`
  - **副作用**: 无

### 用例 3: 不存在的 adapter

- **Precondition**: 指定的 adapter 名称不存在（如 `name=nonexistent`）
- **Command**: `sumeru adapter models nonexistent`
- **Postcondition**:
  - **text**: 输出包含错误信息
  - **json**: 返回错误对象
  - **副作用**: exit code 非 0

## 相关测试用例

- `adapter-models-list.test.yaml`
