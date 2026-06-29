---
scenario: 删除 Skill 时检查反向引用，被 prototype 引用时拒绝删除
feature: skill-delete-reverse-reference-protection
tags: [skill, delete, reference-check, protection, api, conflict]
---

# Skill 删除 — 反向引用保护

## Given

- Sumeru Host 已启动，监听端口 `7900`
- Skill `coding-standards` 存在于 `<dataDir>/skills/coding-standards.md`
- Prototype `coder`（文件 `<dataDir>/prototypes/coder.yaml`）的 `skills` 数组包含 `"coding-standards"`
- Prototype `reviewer`（文件 `<dataDir>/prototypes/reviewer.yaml`）的 `skills` 数组包含 `"coding-standards"`

---

## When — DELETE 被引用的 Skill

```bash
curl -X DELETE http://localhost:7900/skills/coding-standards
```

## Then — 409 Conflict

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "skill_referenced",
    "message": "Skill coding-standards is referenced by prototypes: coder, reviewer"
  }
}
```

**行为说明:**
- 扫描 `<dataDir>/prototypes/` 下所有 `.yaml` 文件
- 解析每个 prototype 的 `skills[]` 数组
- 若任何 prototype 包含该 skill 名称，返回 409
- 响应 message 中列出所有引用该 skill 的 prototype 名称，逗号分隔

---

## When — DELETE 无引用的 Skill

### Given（调整前置条件）

- Skill `deprecated-tool` 存在于磁盘
- 没有任何 prototype 的 `skills[]` 包含 `"deprecated-tool"`

```bash
curl -X DELETE http://localhost:7900/skills/deprecated-tool
```

## Then — 204 No Content

```
(empty body)
```

**副作用:**
- 文件 `<dataDir>/skills/deprecated-tool.md` 已从磁盘删除
- 后续 GET `/skills/deprecated-tool` 返回 404

---

## When — DELETE 不存在的 Skill

```bash
curl -X DELETE http://localhost:7900/skills/nonexistent
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

## 反向引用扫描逻辑

```
findPrototypeReferencesToSkill(prototypesDir, skillName):
  1. 列出 prototypesDir 下所有 .yaml 文件
  2. 逐个解析为 Prototype 对象
  3. 检查 prototype.skills.includes(skillName)
  4. 收集所有匹配的 prototype 名称
  5. 返回 string[]（可能为空）
```

**设计决策:**
- 先检查 skill 是否存在（不存在直接 404）
- 再扫描引用（有引用则 409）
- 最后执行删除（无引用时 unlink 文件）
- 扫描是全量遍历，prototype 数量少时性能可接受

---

## Notes

- 这是引用完整性保护机制，防止删除仍在使用的 skill 导致 session 创建失败
- 409 响应明确告知调用方哪些 prototypes 需要先解除引用
- 调用方应先 PUT 更新相关 prototype 移除 skill 引用，再重试 DELETE
- 名称校验在 `deleteSkill` 中通过 `validateResourceName` 执行
