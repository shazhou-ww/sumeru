# Adapter 列表与详情

> atest: [`adapter-list.test.yaml`](./adapter-list.test.yaml)

Adapter 是 Sumeru 支持的 agent 运行时类型。每个 adapter 在构建时注册到 Host 的 adapter registry，通过 manifest 声明其能力。Adapter 为只读实体——不支持 CRUD，仅在编译/部署时注册。

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

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /adapters | 列出所有已注册 adapter |
| GET | /adapters/:name | 单个 adapter 详情 |
| GET | /adapters/:name/models | 列出 adapter 平台内置模型 |

### 响应信封

列表：
```json
{
  "type": "@sumeru/adapter-list",
  "value": [
    {
      "name": "cursor-agent",
      "providerMode": "builtin-only",
      "credentialEnv": "CURSOR_API_KEY",
      "listModels": false
    },
    {
      "name": "claude-code",
      "providerMode": "both",
      "credentialEnv": "ANTHROPIC_API_KEY",
      "listModels": true
    }
  ]
}
```

单个：
```json
{
  "type": "@sumeru/adapter",
  "value": {
    "name": "cursor-agent",
    "providerMode": "builtin-only",
    "credentialEnv": "CURSOR_API_KEY",
    "listModels": false
  }
}
```

模型列表：
```json
{
  "type": "@sumeru/adapter-model-list",
  "value": [
    {
      "id": "claude-sonnet-4-20250514",
      "name": "Claude Sonnet 4",
      "contextWindow": 200000
    }
  ]
}
```

### 模型列表错误

| HTTP | error | 说明 |
|------|-------|------|
| 404 | `models_not_supported` | adapter 未实现 listModels |
| 400 | `credential_missing` | credentialEnv 未设置或环境变量为空 |
| 502 | `model_list_failed` | 平台 API 调用失败 |

注意：Adapter 在 Host 启动时从 adapter registry 加载，无 POST/PUT/DELETE 端点。

---

## Scenario: 列出所有 Adapter

**When** `GET /adapters`

**Then** 200，返回 `@sumeru/adapter-list`，按 name 字母序排列

**Then** 列表包含已知 adapter（如 `cursor-agent`、`claude-code`、`sarsapa`）

**Then** 每项 `listModels` 为 boolean

---

## Scenario: 获取单个 Adapter 详情

**When** `GET /adapters/cursor-agent`

**Then** 200，返回 `@sumeru/adapter`

**When** `GET /adapters/nonexistent`

**Then** 404，`adapter_not_found`

---

## Scenario: 列出 Adapter 内置模型

**When** `GET /adapters/claude-code/models`（`ANTHROPIC_API_KEY` 已设置）

**Then** 200，返回 `@sumeru/adapter-model-list`

**When** `GET /adapters/sarsapa/models`

**Then** 404，`models_not_supported`

**When** `GET /adapters/claude-code/models`（凭证未设置）

**Then** 400，`credential_missing`

**When** 平台 API 失败

**Then** 502，`model_list_failed`