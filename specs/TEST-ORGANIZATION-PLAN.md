# 测试组织重构计划（草案）

> 状态：讨论中，尚未定稿

## 背景

当前 `specs/atest/` 有 43 个 YAML spec，但缺乏系统性组织：
- 文件命名不一致（`*-crud` vs `*-lifecycle` vs 场景编号）
- 不知道哪些子命令被覆盖了、哪些没有
- 未来补 HTTP API 测试时更混乱

## 核心设计

### 分层

Sumeru 有两个可测试的表面：

| 层 | 性质 | 测试工具 |
|----|------|---------|
| **CLI 层** | 用户直接交互的命令 | atest（当前） |
| **HTTP API 层** | Host REST API（第三方集成用） | atest + 未来 HTTP step 扩展 |

当前阶段先聚焦 CLI 层。HTTP API 测试等 atest 支持 HTTP step 后再补。

### 目录结构

```
specs/
├── cli/                          # 按命令树组织的行为规格（markdown）
│   ├── server/
│   │   ├── status.md             # sumeru server status 的预期行为
│   │   ├── start.md
│   │   ├── stop.md
│   │   └── restart.md
│   ├── session/
│   │   ├── add.md                # sumeru session add 的预期行为
│   │   ├── list.md
│   │   ├── get.md
│   │   ├── send.md
│   │   ├── stop.md
│   │   ├── turns.md
│   │   ├── exec.md
│   │   ├── reset.md
│   │   ├── snapshot.md
│   │   ├── remove.md
│   │   └── logs.md
│   ├── prototype/
│   │   ├── add.md
│   │   ├── list.md
│   │   ├── get.md
│   │   ├── update.md
│   │   └── remove.md
│   ├── persona/
│   │   ├── add.md
│   │   ├── list.md
│   │   ├── get.md
│   │   └── remove.md
│   ├── provider/
│   │   ├── add.md
│   │   ├── list.md
│   │   ├── get.md
│   │   ├── update.md
│   │   └── remove.md
│   ├── model/
│   │   ├── add.md
│   │   ├── list.md
│   │   ├── get.md
│   │   ├── update.md
│   │   └── remove.md
│   └── adapter/
│       ├── list.md
│       ├── get.md
│       └── models.md
│
└── atest/                        # 跨命令的端到端用例（YAML）
    ├── session-lifecycle.test.yaml
    ├── provider-crud.test.yaml
    └── ...
```

### 双向关联

spec 和 atest case 是多对多关系：
- 一个 spec（如 `session add`）被多个 case 覆盖
- 一个 case（如 `session-lifecycle`）覆盖多个 spec

**spec → cases**（在 markdown frontmatter 中）：

```yaml
---
command: sumeru session add
description: 创建新 session
related_cases:
  - session-lifecycle.test.yaml
  - session-create-no-task.test.yaml
  - session-with-project.test.yaml
  - error-paths.test.yaml
---

# sumeru session add

## 行为

...
```

**case → specs**（在 YAML frontmatter 中）：

```yaml
---
name: session lifecycle
description: Session 全生命周期操作链
related_specs:
  - cli/session/add.md
  - cli/session/list.md
  - cli/session/get.md
  - cli/session/send.md
  - cli/session/turns.md
  - cli/session/stop.md
  - cli/session/remove.md
---
```

### 验证脚本

写一个脚本扫描双向关联：
- 找出**孤立 spec**：有 spec 但没有 case 覆盖
- 找出**孤立 case**：有 case 但没有关联任何 spec
- 找出**断链**：spec 引用的 case 不存在，或 case 引用的 spec 不存在

## 已确认的决策

1. **Host API 是公开契约** — Sumeru 的本质是把一台机器的 agentic 能力标准化暴露出来，第三方集成需要直接调 API
2. **两层分离** — CLI 层（当前 atest）+ HTTP API 层（等 atest 支持 HTTP step 后补）
3. **spec 按命令树组织** — `specs/cli/<command>/<subcommand>.md` 穷尽覆盖每个子命令的预期行为
4. **spec ↔ case 多对多双向关联** — spec frontmatter 列 `related_cases`，case frontmatter 列 `related_specs`
5. **atest HTTP step 扩展** — 已开 [agentic-test-runner#1](https://git.shazhou.work/shazhou/agentic-test-runner/issues/1)，小墨负责
6. **atest case 可能跨越多个子命令** — 一个 case 覆盖多个 spec，这是多对多的根因

## 待讨论

- [ ] spec markdown 的内容应该写什么？纯行为契约还是含示例？
- [ ] 每个子命令的 test case 要怎么写？（atest step 的组织方式）
- [ ] atest YAML 文件名要不要统一？当前命名有些不一致
- [ ] HTTP API 层的 spec 放哪里？`specs/api/` 还是和 CLI 混在一起？
- [ ] `specs/SCENARIOS.md` 还保留吗？它和新的 cli/ 目录是什么关系？
- [ ] 验证脚本放哪里？`scripts/` 还是 `tools/`？
