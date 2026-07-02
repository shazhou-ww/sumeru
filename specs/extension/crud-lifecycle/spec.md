---
scenario: Extension 完整 CRUD 生命周期
feature: Extension CRUD API
tags: [extension, crud, lifecycle]
---

# Extension 完整 CRUD 生命周期

Extension 是可复用的 Dockerfile 指令集，Prototype 可通过 `extensions` 字段引用。存储为 `extensions/<name>.yaml` 文件，模式与 Prototype 相同。

Extension 仅支持 Dockerfile 指令，不包含本地 context 文件。

## Extension 字段

```yaml
name: rust              # 唯一标识，匹配 URL 路径参数
description: Rust toolchain
dockerfile: |
  RUN apt-get update && apt-get install -y rustc cargo
createdAt: "2026-07-02T12:00:00.000Z"
updatedAt: "2026-07-02T12:00:00.000Z"
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ (URL) | 唯一标识，来自 URL `:name` |
| description | string | ❌ | 人类可读描述，默认空字符串 |
| dockerfile | string | ✅ (新建) | 非空 Dockerfile 指令片段 |
| createdAt | string | ❌ | ISO 时间戳，新建时自动生成 |
| updatedAt | string | ❌ | ISO 时间戳，更新时自动刷新 |

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | /extensions | 列出所有 |
| GET | /extensions/:name | 单个详情 |
| PUT | /extensions/:name | upsert（201 新建 / 200 替换） |
| DELETE | /extensions/:name | 删除（204 / 404） |

PUT 使用 merge 语义 — 省略的字段保留现有值。新建时 `dockerfile` 必填。

### 响应信封

列表：
```json
{
  "type": "@sumeru/extension-list",
  "value": [
    {
      "name": "rust",
      "description": "Rust toolchain",
      "dockerfile": "RUN apt-get install -y rustc",
      "createdAt": "2026-07-02T12:00:00.000Z",
      "updatedAt": "2026-07-02T12:00:00.000Z"
    }
  ]
}
```

单个：
```json
{
  "type": "@sumeru/extension",
  "value": {
    "name": "rust",
    "description": "Rust toolchain",
    "dockerfile": "RUN apt-get install -y rustc",
    "createdAt": "2026-07-02T12:00:00.000Z",
    "updatedAt": "2026-07-02T12:00:00.000Z"
  }
}
```

---

## Scenario: 列出所有 Extension

**When** `GET /extensions`

**Then** 200，返回 `@sumeru/extension-list`

---

## Scenario: 获取单个 Extension 详情

**When** `GET /extensions/rust`

**Then** 200，返回 `@sumeru/extension`

**When** `GET /extensions/nonexistent`

**Then** 404，`extension_not_found`

---

## Scenario: 创建 Extension

**When** `PUT /extensions/rust`

```json
{
  "description": "Rust toolchain",
  "dockerfile": "RUN apt-get install -y rustc"
}
```

**Then** 201，返回 `@sumeru/extension`

**When** 再次 `PUT /extensions/rust`（同名，含新 dockerfile）

**Then** 200，返回 `@sumeru/extension`（替换已有资源）

---

## Scenario: 创建缺少 dockerfile 的 Extension

**When** `PUT /extensions/rust`

```json
{
  "description": "Rust toolchain"
}
```

**Then** 400，`invalid_body`

---

## Scenario: 删除 Extension

**When** `DELETE /extensions/rust`

**Then** 204

**When** 再 `GET /extensions/rust`

**Then** 404

---

## Scenario: 删除不存在 Extension

**When** `DELETE /extensions/ghost`

**Then** 404，`extension_not_found`
