---
scenario: Skill 的幂等创建/更新与读取
feature: skill-crud-idempotent
tags: [skill, crud, api, idempotent, happy-path]
---

# Skill CRUD — 幂等写入与读取

## Given

- Sumeru Host 已启动，监听端口 `7900`
- `host.yaml` 配置了 `dataDir`，skills 目录 `<dataDir>/skills/` 已就绪
- Skill 名称必须匹配 `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`

---

## When — PUT 创建新 Skill（JSON body）

```bash
curl -X PUT http://localhost:7900/skills/git-workflow \
  -H "Content-Type: application/json" \
  -d '{"content": "# Git Workflow\n\nAlways use feature branches..."}'
```

## Then — 200 OK（创建成功）

```json
{
  "type": "@sumeru/skill",
  "value": {
    "name": "git-workflow",
    "content": "# Git Workflow\n\nAlways use feature branches..."
  }
}
```

**副作用:**
- 文件 `<dataDir>/skills/git-workflow.md` 已写入磁盘
- 使用 atomic write（先写 `.tmp` 再 `rename`），确保不会出现半写状态

---

## When — PUT 更新已存在的 Skill（幂等）

```bash
curl -X PUT http://localhost:7900/skills/git-workflow \
  -H "Content-Type: application/json" \
  -d '{"content": "# Git Workflow v2\n\nUse trunk-based development..."}'
```

## Then — 200 OK（覆盖更新，相同状态码）

```json
{
  "type": "@sumeru/skill",
  "value": {
    "name": "git-workflow",
    "content": "# Git Workflow v2\n\nUse trunk-based development..."
  }
}
```

**幂等性保证:**
- 无论 skill 是否已存在，PUT 均返回 200
- 不区分 create 与 update，调用方无需先检查是否存在
- 多次 PUT 相同内容，结果一致

---

## When — PUT 使用 plain text body

```bash
curl -X PUT http://localhost:7900/skills/docker-tips \
  -H "Content-Type: text/plain" \
  -d '# Docker Tips

Use multi-stage builds for smaller images.'
```

## Then — 200 OK

```json
{
  "type": "@sumeru/skill",
  "value": {
    "name": "docker-tips",
    "content": "# Docker Tips\n\nUse multi-stage builds for smaller images."
  }
}
```

**支持两种 Content-Type:**
- `application/json` → 解析 `{ content: string }`
- 其他（含 `text/plain`）→ 将整个 body 作为 content

---

## When — GET 读取已存在的 Skill

```bash
curl http://localhost:7900/skills/git-workflow
```

## Then — 200 OK

```json
{
  "type": "@sumeru/skill",
  "value": {
    "name": "git-workflow",
    "content": "# Git Workflow v2\n\nUse trunk-based development..."
  }
}
```

---

## When — GET 读取不存在的 Skill

```bash
curl http://localhost:7900/skills/nonexistent
```

## Then — 404 Not Found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skill_not_found",
    "message": "Skill nonexistent not found"
  }
}
```

---

## When — PUT 名称不合法

```bash
curl -X PUT http://localhost:7900/skills/.invalid-name \
  -H "Content-Type: text/plain" \
  -d 'some content'
```

## Then — 400 Bad Request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_name",
    "message": "skill name must match ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ (got \".invalid-name\")"
  }
}
```

---

## When — PUT body 格式无效（JSON 但缺少 content 字段）

```bash
curl -X PUT http://localhost:7900/skills/bad-body \
  -H "Content-Type: application/json" \
  -d '{"text": "wrong field"}'
```

## Then — 400 Bad Request

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "invalid_body",
    "message": "Skill body must be plain text or JSON { content: string }"
  }
}
```

---

## Notes

- Skill 存储为纯 markdown 文件：`<dataDir>/skills/<name>.md`
- PUT 是幂等操作，适合 CI/CD pipeline 中批量同步 skills
- 名称校验在 `data-store.ts` 的 `validateResourceName` 中执行
- 写入使用 temp + rename 模式保证原子性
