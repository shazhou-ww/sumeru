---
scenario: Adapter 列表与详情
feature: Adapter List API
tags: [adapter, read, list]
---

# Adapter 列表与详情

Adapter 是 Sumeru 支持的 agent 运行时类型。每个 adapter 在构建时注册到 Host 的 adapter registry，通过 manifest 声明其能力。Adapter 为只读实体——不支持 CRUD，仅在编译/部署时注册。

## Adapter 字段

```yaml
name: cursor-agent          # 唯一标识，匹配 URL 路径参数
providerMode: builtin-only  # custom-only | both | builtin-only
credentialEnv: CURSOR_API_KEY  # 平台凭证环境变量名，custom-only 时为 null
listModels: null            # Phase 4 预留：是否支持列出内置模型
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
      "listModels": null
    },
    {
      "name": "claude-code",
      "providerMode": "both",
      "credentialEnv": "ANTHROPIC_API_KEY",
      "listModels": null
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
    "listModels": null
  }
}
```

注意：Adapter 在 Host 启动时从 adapter registry 加载，无 POST/PUT/DELETE 端点。

---

## Scenario: 列出所有 Adapter

**When** `GET /adapters`

**Then** 200，返回 `@sumeru/adapter-list`，按 name 字母序排列

**Then** 列表包含已知 adapter（如 `cursor-agent`、`claude-code`、`sarsapa`）

---

## Scenario: 获取单个 Adapter 详情

**When** `GET /adapters/cursor-agent`

**Then** 200，返回 `@sumeru/adapter`

**When** `GET /adapters/nonexistent`

**Then** 404，`adapter_not_found`
