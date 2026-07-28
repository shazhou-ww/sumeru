# Adapter 行为规范

Adapter 是 Sumeru 支持的 agent 运行时类型。每个 adapter 在构建时注册到 Host 的 adapter registry，通过 manifest 声明其能力。Adapter 为**只读实体**——不支持 CRUD，仅在编译/部署时注册。

## Adapter 字段

```yaml
name: cursor-agent          # 唯一标识，匹配 URL 路径参数
providerMode: builtin-only  # custom-only | both | builtin-only
credentialEnv: CURSOR_API_KEY  # 平台凭证环境变量名，custom-only 时为 null
listModels: false           # 是否支持列出内置模型（API 响应为 boolean）
```

### providerMode 说明

- `custom-only` — 仅使用自定义 Provider/Model（SQLite 实体）
- `both` — 支持自定义 Provider/Model 和平台内置 provider
- `builtin-only` — 仅使用平台内置 provider，不需要 Provider/Model 实体

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | /adapters | 列出所有已注册 adapter |
| GET | /adapters/:name | 单个 adapter 详情 |
| GET | /adapters/:name/models | 列出 adapter 平台内置模型 |

### 响应信封

```json
{ "type": "@sumeru/adapter-list", "value": [...] }
{ "type": "@sumeru/adapter", "value": { "name": "...", "providerMode": "...", "credentialEnv": "...", "builtinModels": [] } }
```

### 错误响应

| 状态码 | 场景 |
|--------|------|
| 404 | adapter 不存在 |

---

## CLI 命令

### sumeru adapter list

列出所有已注册的 adapter。

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |
| `--limit` | integer | - | 20 | 每页返回数量 |
| `--offset` | integer | - | 0 | 偏移量 |

### sumeru adapter get \<name\>

获取指定 adapter 的详细配置信息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | adapter 名称 |
| `--format` | string | 否 | 输出格式 |
| `--compact` | boolean | 否 | 紧凑输出 |
| `--quiet` | boolean | 否 | 静默模式 |

**不存在时**：返回 404 错误。

### sumeru adapter models \<name\>

列出指定 adapter 注册时声明的内置模型列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | adapter 名称 |
| `--format` | string | 否 | 输出格式 |
| `--compact` | boolean | 否 | 紧凑输出 |
| `--quiet` | boolean | 否 | 静默模式 |
| `--limit` | integer | 否 | 每页数量 |
| `--offset` | integer | 否 | 偏移量 |

**注意**：并非所有 adapter 都有内置模型。`custom-only` 类型的 adapter（如 hermes）会提示不支持。
