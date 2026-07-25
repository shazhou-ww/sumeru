---
command: sumeru adapter get <name>
group: adapter
description: 获取指定 adapter 的详细信息
parameters:
  - name: name
    type: string
    required: true
    position: 1
    description: adapter 名称（如 sarsapa, hermes, claude-code）
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

获取指定 adapter 的详细配置信息，包括其 providerMode（供给模式）、所需凭证、内置模型列表、以及支持的能力集。

## 参数表

| 参数 | 类型 | 必填 | 位置 | 默认值 | 说明 |
|------|------|------|------|--------|------|
| `name` | string | 是 | 1 | - | adapter 名称 |
| `--format` | string | 否 | - | text | 输出格式（yaml, json, text, html） |
| `--compact` | boolean | 否 | - | false | 紧凑输出 |
| `--quiet` | boolean | 否 | - | false | 静默模式 |

## 用例

### 用例 1: 存在的 adapter

- **Precondition**: 指定的 adapter 已注册（如 `name=sarsapa`）
- **Command**: `sumeru adapter get sarsapa`
- **Postcondition**:
  - **text**: 输出包含 adapter 名称、`providerMode`（如 `builtin` 或 `external`）等详细信息
  - **json**: 返回完整 adapter 信息对象，包含 `name`、`providerMode`、`credentialEnv`、`builtinModels` 等字段
  - **副作用**: 无

### 用例 2: 不存在的 adapter

- **Precondition**: 指定的 adapter 名称不存在（如 `name=nonexistent`）
- **Command**: `sumeru adapter get nonexistent`
- **Postcondition**:
  - **text**: 输出包含 `adapter_not_found` 或 404 相关错误信息
  - **json**: 返回错误对象，包含错误码和描述
  - **副作用**: exit code 非 0

## 相关测试用例

- `adapter-list-and-get.test.yaml`
