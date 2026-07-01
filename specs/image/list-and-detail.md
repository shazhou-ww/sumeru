---
scenario: 查询镜像列表与单个镜像详情
feature: image-list-and-detail
tags: [image, read-only, api, registry, happy-path]
---

# Image 列表与详情查询

## Given

- Sumeru Host 已启动
- `images.yaml` 中注册了镜像（通过 `POST /images/:name` 或 `sumeru image build` 注册）

---

## When — GET 镜像列表

```bash
curl -s http://127.0.0.1:$SUMERU_PORT/images
```

## Then — 200 OK

```json
{
  "type": "@sumeru/image-list",
  "value": [
    {
      "name": "hermes",
      "description": "Sumeru hermes image (sumeru/hermes:dev)",
      "dockerfile": "docker/hermes/Dockerfile",
      "builtAt": "2026-07-01T09:17:24.720Z",
      "digest": "sha256:c3428a77732cf..."
    }
  ]
}
```

**字段说明:**
| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | 镜像注册名（唯一标识） |
| `description` | `string` | 镜像用途描述 |
| `dockerfile` | `string` | Dockerfile 相对路径 |
| `builtAt` | `string` | ISO 8601 格式的构建时间 |
| `digest` | `string` | Docker image digest |

---

## When — GET 单个镜像详情

```bash
curl -s http://127.0.0.1:$SUMERU_PORT/images/hermes
```

## Then — 200 OK

```json
{
  "type": "@sumeru/image",
  "value": {
    "name": "hermes",
    "description": "Sumeru hermes image (sumeru/hermes:dev)",
    "dockerfile": "docker/hermes/Dockerfile",
    "builtAt": "2026-07-01T09:17:24.720Z",
    "digest": "sha256:c3428a77732cf..."
  }
}
```

---

## When — GET 不存在的镜像

```bash
curl -s http://127.0.0.1:$SUMERU_PORT/images/nonexistent
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

```bash
curl -s http://127.0.0.1:$SUMERU_PORT/images
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

- Image 通过 `POST /images/:name` 注册/更新，`DELETE /images/:name` 注销
- `sumeru image build` 成功后自动调 POST 注册
- `prototype add --image <name>` 引用注册名，host 校验 image 存在
- Image 类型定义在 `@sumeru/core` 的 `types.ts` 中
