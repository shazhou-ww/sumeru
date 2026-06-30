---
name: specs-l2-conversion
description: "Convert flat spec files into directory+tc (L1/L2) format. Each spec.md becomes a directory with spec.md (unchanged) + tc-*.md test cases."
tags: [specs, testing, conversion, sumeru]
triggers:
  - convert spec
  - tc format
  - L1/L2
  - spec restructure
  - specs directory
---

# Specs L1/L2 Conversion

将 specs/ 下的单文件 spec 转换为目录结构：

```
specs/<domain>/<name>.md  →  specs/<domain>/<name>/
                               ├── spec.md          (原文件内容，不改)
                               ├── tc-xxx.md        (验证用例 1)
                               ├── tc-yyy.md        (验证用例 2)
                               └── tc-zzz.md        (验证用例 3)
```

## 何时用

- 被指示转换某个 spec 文件时
- Issue #176 的批量转换任务

## 步骤

### 1. 创建目录 + 搬移 spec

```bash
mkdir -p specs/<domain>/<name>/
mv specs/<domain>/<name>.md specs/<domain>/<name>/spec.md
```

### 2. 阅读 spec.md 提取场景

读 spec.md 的 When/Then 段，每个独立的 When/Then 对 = 一个潜在 tc。

**分组原则**：一个 tc 回答一个验证问题。多个相关断言可以合并（如"创建成功 + 返回正确字段"），不相关的拆开（如"成功创建" vs "404 错误"）。

### 3. 编写 tc 文件

每个 tc 必须包含：

```markdown
---
id: tc-<kebab-name>
spec: <parent-spec-name>
tags: [e2e, <domain>, <relevant-tags>]
prerequisites:
  - Sumeru host running (port 7901)
  - <other requirements>
---

# <Title>

<一句话说明验证什么>

## Setup

1. <环境准备步骤，可复制粘贴的命令>

## Steps

1. <动作>：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/... \
     -H 'Content-Type: application/json' \
     -d '{...}'
   ```
   → <简述预期>

## Expected

- [ ] <具体可断言的预期结果>
- [ ] <另一个断言>

## Failure Signals

- <常见失败现象> → <排查方向>
```

### 4. 命名规则

- **tc 文件名**: `tc-<描述性kebab>.md`，不带编号
- **一个 tc = 一个验证关切**，可有多步和多断言
- **curl 端口统一用 7901**
- **model 字段用对象格式**: `{"provider": "anthropic", "name": "claude-opus-4.6"}`（不是字符串）

## tc 编写铁律

1. **Steps 必须可复制粘贴** — 不用伪代码或省略号
2. **Expected 用 checkbox** — 验证者（人或 agent）逐条勾
3. **Failure Signals 降低排错门槛** — 常见失败原因 + 排查方向
4. **不改 spec.md** — L1 内容不动，tc 是增量

## 参考样本

已完成的转换：
- `specs/session/create-and-start/` — 3 个 tc (happy-path, provider-promotion, env-var-expansion)
- `specs/session/list-and-detail/` — 3 个 tc (list-all, detail-not-found, list-empty)

## Pitfalls

1. **model 字段格式**: 当前 API 要求 model 是对象 `{"provider":"anthropic","name":"..."}` 或 null，不接受纯字符串
2. **不要创建过多 tc**: 2-4 个覆盖主要场景即可（happy path + 关键错误路径），边界 case 留给 comprehensive suite
3. **spec.md 内容校验**: mv 后用 md5sum 对比确认内容未变
4. **原文件必须删除**: mv 不是 cp，原路径不应存在

## 关联

- Issue #176: 追踪所有 spec 转换进度
- `specs/suites/e2e.yaml`: 转换后的 tc 需要加入 suite
- walkthrough-qa skill: tc 的消费方式（按 suite 批量跑）
