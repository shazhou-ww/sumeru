---
scenario: 查询镜像列表与单个镜像详情
feature: image-list-and-detail
tags: [image, read-only, api, registry, happy-path]
---

# Image 列表与详情查询

## Given

- Sumeru Host 已启动，监听端口 `7900`
- `host.yaml` 的 `images` 配置（或独立 `images.yaml`）中注册了以下镜像：

```yaml
images:
  - name: sumeru-coder
    description: "Full development environment with Node.js and Python"
    dockerfile: "cas://sha256:abc123..."
    builtAt: "2026-06-15T08:30:00.000Z"
    digest: "sha256:a1b2c3d4e5f6..."
  - name: sumeru-minimal
    description: "Minimal sandbox for quick tasks"
    dockerfile: "cas://sha256:def456..."
    builtAt: "2026-06-20T14:00:00.000Z"
    digest: "sha256:f6e5d4c3b2a1..."
```

- 镜像数据在启动时加载到内存 `hostConfig.images` Map 中
- Image 为只读资源，不支持 POST/PUT/DELETE

---

## When — GET 镜像列表

```bash
curl http://localhost:7900/images
```

## Then — 200 OK

```json
{
  "type": "@sumeru/image-list",
  "value": [
    {
      "name": "sumeru-coder",
      "description": "Full development environment with Node.js and Python",
      "dockerfile": "cas://sha256:abc123...",
      "builtAt": "2026-06-15T08:30:00.000Z",
      "digest": "sha256:a1b2c3d4e5f6..."
    },
    {
      "name": "sumeru-minimal",
      "description": "Minimal sandbox for quick tasks",
      "dockerfile": "cas://sha256:def456...",
      "builtAt": "2026-06-20T14:00:00.000Z",
      "digest": "sha256:f6e5d4c3b2a1..."
    }
  ]
}
```

**字段说明:**
| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | 镜像唯一标识名 |
| `description` | `string` | 镜像用途描述 |
| `dockerfile` | `string` | Dockerfile 的 CAS（Content-Addressable Storage）引用 |
| `builtAt` | `string` | ISO 8601 格式的构建时间 |
| `digest` | `string` | 镜像内容摘要，格式 `sha256:...` |

---

## When — GET 单个镜像详情

```bash
curl http://localhost:7900/images/sumeru-coder
```

## Then — 200 OK

```json
{
  "type": "@sumeru/image",
  "value": {
    "name": "sumeru-coder",
    "description": "Full development environment with Node.js and Python",
    "dockerfile": "cas://sha256:abc123...",
    "builtAt": "2026-06-15T08:30:00.000Z",
    "digest": "sha256:a1b2c3d4e5f6..."
  }
}
```

---

## When — GET 不存在的镜像

```bash
curl http://localhost:7900/images/nonexistent
```

## Then — 404 Not Found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "image_not_found",
    "message": "Image nonexistent not found"
  }
}
```

---

## When — 无镜像注册时查询列表

### Given（调整前置条件）

- `host.yaml` 中未配置任何 images

```bash
curl http://localhost:7900/images
```

## Then — 200 OK（空数组）

```json
{
  "type": "@sumeru/image-list",
  "value": []
}
```

---

## Notes

- Image 是只读注册表资源，从配置文件加载，不支持运行时创建/修改/删除
- 镜像构建是 ops 任务，不通过 API 触发
- `hostConfig.images` 是 `Map<string, Image>`，列表接口通过 `[...map.values()]` 返回
- 详情接口通过 `map.get(name)` 查找，未命中返回 404
- Image 类型定义在 `@sumeru/core` 的 `types.ts` 中
