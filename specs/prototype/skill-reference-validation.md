---
scenario: Prototype 引用不存在的 Skill 时校验失败
feature: Skill 引用校验
tags: [prototype, skill, validation, error]
---

# Prototype Skill 引用校验

创建或更新 Prototype 时，`skills` 数组中引用的每个 skill 必须在系统中实际存在。若存在不存在的 skill 引用，返回 `400` 并明确列出缺失的 skill 名称。

## 背景

`assertSkillsExist(skillsDir, skillNames)` 函数逐一检查 `skills` 数组中每个 skill 名称对应的文件（`<skillsDir>/<name>.md`）是否存在，收集所有不存在的 skill 名称作为 `missing` 数组返回。

---

## Scenario: 创建 Prototype 引用不存在的 Skill

**Given** 系统中存在 skill `bash`，但不存在 skill `docker` 和 `kubernetes`

**When** 发送请求：

```http
POST /prototypes/deploy-agent
Content-Type: application/json

{
  "name": "deploy-agent",
  "instructions": "Handles deployment tasks.",
  "skills": ["bash", "docker", "kubernetes"]
}
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "skills_not_found",
    "message": "Missing skills: docker, kubernetes"
  }
}
```

---

## Scenario: 更新 Prototype 引用不存在的 Skill

**Given** 存在 prototype `my-agent`，系统中不存在 skill `nonexistent-tool`

**When** 发送请求：

```http
PUT /prototypes/my-agent
Content-Type: application/json

{
  "name": "my-agent",
  "instructions": "Updated agent.",
  "skills": ["nonexistent-tool"]
}
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "skills_not_found",
    "message": "Missing skills: nonexistent-tool"
  }
}
```

---

## Scenario: 多个 Skill 全部不存在

**Given** 系统中不存在 skill `alpha`、`beta`、`gamma`

**When** 发送请求：

```http
POST /prototypes/multi-fail
Content-Type: application/json

{
  "name": "multi-fail",
  "instructions": "Test multiple missing skills.",
  "skills": ["alpha", "beta", "gamma"]
}
```

**Then** 响应状态码为 `400`，错误消息列出所有缺失 skill：

```json
{
  "error": {
    "code": "skills_not_found",
    "message": "Missing skills: alpha, beta, gamma"
  }
}
```

---

## Scenario: 所有引用的 Skill 均存在（校验通过）

**Given** 系统中存在 skill `bash` 和 `git`

**When** 发送请求：

```http
POST /prototypes/valid-agent
Content-Type: application/json

{
  "name": "valid-agent",
  "instructions": "Agent with valid skills.",
  "skills": ["bash", "git"]
}
```

**Then** 响应状态码为 `201`，创建成功：

```json
{
  "prototype": {
    "name": "valid-agent",
    "instructions": "Agent with valid skills.",
    "skills": ["bash", "git"],
    "defaults": null
  }
}
```

---

## Scenario: skills 为空数组时跳过校验

**Given** 系统中无任何 skill

**When** 发送请求：

```http
POST /prototypes/no-skills
Content-Type: application/json

{
  "name": "no-skills",
  "instructions": "Agent without skills.",
  "skills": []
}
```

**Then** 响应状态码为 `201`，创建成功（无 skill 需要校验）

---

## 实现细节

### 校验函数

```typescript
// packages/host/src/data-store.ts
export async function assertSkillsExist(
  skillsDir: string,
  skillNames: Array<string>,
): Promise<Array<string>> {
  const missing: Array<string> = [];
  for (const skillName of skillNames) {
    if (!(await skillExists(skillsDir, skillName))) {
      missing.push(skillName);
    }
  }
  return missing;
}
```

### 调用方逻辑

```typescript
// packages/host/src/handlers/prototypes.ts（upsertPrototype 函数）
const missing = await assertSkillsExist(hostConfig.skillsDir, prototype.skills);
if (missing.length > 0) {
  writeJson(res, 400, errorEnvelope(
    "skills_not_found",
    `Missing skills: ${missing.join(", ")}`,
  ));
  return;
}
```

### 关键行为

| 行为 | 说明 |
|------|------|
| 校验时机 | 创建（POST）和更新（PUT）时均执行 |
| 校验范围 | 逐一检查 `skills` 数组中每个名称 |
| 检查方式 | 尝试 `access(<skillsDir>/<name>.md>`，文件不存在则视为缺失 |
| 错误码 | `skills_not_found` |
| 错误消息格式 | `"Missing skills: <name1>, <name2>, ..."` |
| 返回所有缺失项 | 是，一次性列出全部不存在的 skill |

源码参考：`packages/host/src/data-store.ts`（第 165–176 行）、`packages/host/src/handlers/prototypes.ts`（第 125–139 行）
