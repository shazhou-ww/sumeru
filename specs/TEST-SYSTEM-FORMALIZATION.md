# CLI / API 行为测试系统的形式化（草案）

> 状态：理论讨论，尚未进入工程实施

## 1 动机

Sumeru 是一个状态化系统：它管理 provider、model、prototype、session、Docker 容器等资源，
每个子命令都是一次状态变换。当前的 atest 是**扁平的执行路径**——每个 YAML 文件包含
一条完整的 setup → action → verify 链，路径之间无法复用，状态无法共享。

本文尝试形式化描述一个**树状测试体系**：用声明式的状态和变换描述，自动生成
可执行的 atest 路径。目标：

- 最大限度复用测试用例（一个变换被多个计划共享）
- 状态透明（每个节点的上下文是什么）
- 失败隔离（一个变换失败，只影响其子树）

---

## 2 基础模型

### 2.1 系统

一个系统是 **状态空间 S** 和 **变换集合 T** 的组合：

```
System = (S₀, {Tᵢ})

S₀  : 初始状态（空状态）
Tᵢ  : 变换（transition），接收输入，改变状态，产生输出
```

每个变换 Tᵢ 的形式：

```
Tᵢ: (S, Iᵢ) → (S', Oᵢ)

S   : 变换前的系统状态
Iᵢ  : 输入（CLI 命令 / HTTP request）
S'  : 变换后的系统状态
Oᵢ  : 输出（stdout, stderr, exit_code / HTTP response）
```

### 2.2 状态的隐晦性

系统状态 S 是**全局的、隐晦的**。我们无法直接观测 S 的完整内容，只能通过
**探针**（probe）——immutable 指令——来刺探 S 的部分信息。

这意味着：我们无法验证两个状态是否等价，因为我们无法全量比较 S。

### 2.3 树视角

由于无法验证状态等价性，我们放弃 DAG 视角（状态合并），采用**树视角**：

- 状态 S 由其**到达路径**唯一标识
- S = T[]，即从 S₀ 到达当前状态所经过的变换序列
- 空序列 [] 代表初始状态 S₀

```
S₀         = []
S₁         = [T_provider-add]
S₂         = [T_provider-add, T_model-add]
S₃         = [T_provider-add, T_model-add, T_session-add]
```

树视角的好处：
- 每个状态有唯一的路径标识
- 路径本身就是 setup 过程
- 不需要额外的状态等价判定

---

## 3 测试用例

### 3.1 定义

一个测试用例 (TestCase) 是树上的一个**有向边**：

```
TestCase = (id, S_pre, I, Judge)

id    : 用例标识
S_pre : 前置状态（路径，即 T[]）
I     : 输入（mutator 指令）
Judge : 判定函数，验证 I 执行后的 S 是否符合预期
```

TestCase 执行后，产生新状态：

```
S_post = S_pre ++ [TestCase]   // 路径追加
```

### 3.2 Judge

Judge 的形式：**执行一条或多条指令，观察输出，判定是否符合预期**。

```
Judge: (S_pre, I, O, Instructions[]) → {PASS, FAIL}

Instructions[] : 判定过程中执行的指令序列
```

Judge 不需要预先分类指令的 mutable/immutable。Judge 执行前后通过
**Docker 快照机制**保存和恢复现场，因此 Judge 可以执行任何指令，
不会破坏状态链。

```
执行流程：
  1. 保存现场（docker commit / checkpoint）
  2. Judge 执行判定指令（可能 mutable）
  3. 观察输出，判定 PASS / FAIL
  4. 恢复现场（docker restore / revert）
  5. 状态链继续
```

这使得 Judge 的能力大幅增强：可以调用 `session send`、`session add` 等
任何指令来探测系统行为，只要现场能恢复。

### 3.3 状态保护：Docker 快照机制

Judge 可以执行任何指令（包括 mutable），但不会破坏状态链，因为：

| 时机 | 操作 | 机制 |
|------|------|------|
| Judge 执行前 | **保存现场** | `docker commit` → 临时 image |
| Judge 执行中 | 自由执行指令 | 任何指令，包括 mutable |
| Judge 执行后 | **恢复现场** | `docker run` 从临时 image 启动新容器 |

这带来两个重要性质：

1. **Judge 无约束**：不需要区分 probe / mutator，Judge 可以用任何指令来验证
2. **状态链不被污染**：Judge 的副作用被隔离，下一个 TestCase 看到的是干净的 S_post

---

## 4 测试树

### 4.1 结构

所有 TestCase 构成一棵**以 S₀ = [] 为根的树**。每个节点是一个 TestCase，
其父节点是 S_pre 的最后一个 TestCase。

```
S₀ = []
├── T_provider-add (S_pre=[])
│   ├── T_model-add (S_pre=[provider-add])
│   │   ├── T_prototype-add (S_pre=[provider-add, model-add])
│   │   │   ├── T_session-add (S_pre=[..., prototype-add])
│   │   │   │   ├── T_session-stop (S_pre=[..., session-add])
│   │   │   │   └── T_session-remove (S_pre=[..., session-add])
│   │   │   └── T_prototype-update (S_pre=[..., prototype-add])
│   │   └── T_model-update (S_pre=[provider-add, model-add])
│   └── T_provider-update (S_pre=[provider-add])
├── T_persona-add (S_pre=[])
│   └── T_persona-remove (S_pre=[persona-add])
└── T_server-start (S_pre=[])
    └── T_server-stop (S_pre=[server-start])
```

### 4.2 失败传播

如果一个 TestCase 失败（Judge 返回 FAIL），则其**整个子树不可达**。

这符合测试的实际语义：如果 provider-add 失败，依赖它的 model-add、
prototype-add、session-add 都不应该执行。

---

## 5 路径生成

### 5.1 测试计划 (TestPlan)

一个测试计划是树上的一条**从根到某个节点的路径**：

```
TestPlan = [TestCase₁, TestCase₂, ..., TestCaseₙ]

约束：
- TestCase₁.S_pre = []  (从根开始)
- TestCaseᵢ₊₁.S_pre = [TestCase₁, ..., TestCaseᵢ]  (连续路径)
```

### 5.2 从树生成 atest

给定一个 TestPlan，可以自动生成 atest YAML：

```
TestPlan: [provider-add, model-add, prototype-add, session-add]

生成的 atest:
  setup:
    - "sumeru provider add ..."        # provider-add.I
    - "sumeru model add ..."           # model-add.I
    - "sumeru prototype add ..."       # prototype-add.I
  steps:
    - command: "sumeru session add ..."  # session-add.I
      judge: ...                         # session-add.Judge
    - command: "sumeru session get ..."  # session-add.Judge 中的探针
      judge: ...
    - command: "sumeru provider list"    # provider-add.Judge 中的探针（可选）
      judge: ...
```

生成规则：
1. TestPlan 中除最后一个 TestCase 外的所有 I，组成 setup
2. 最后一个 TestCase 的 I + Judge 组成 steps
3. 可选：验证路径上所有 TestCase 的 Judge（全路径验证）

### 5.3 用例复用

一个 TestCase 被多个 TestPlan 共享：

```
provider-add 被以下 plan 共享：
  - [provider-add, model-add, ...]
  - [provider-add, provider-update, ...]
  - [provider-add, provider-remove, ...]
```

不需要在每个 atest 里重复写 `sumeru provider add` 的 setup。

---

## 6 与 Docker Image Chain 的关联

### 6.1 类比

Sumeru 有 Docker Image Chain：

```
sumeru/base:dev
  ├── sumeru/sarsapa:dev
  ├── sumeru/hermes:dev
  └── sumeru/claude-code:dev
```

测试体系有状态链：

```
S₀ = []
  ├── [provider-add]
  ├── [provider-add, model-add]
  └── [provider-add, model-add, prototype-add]
```

### 6.2 状态快照

如果每个命名状态 S 都能被**快照**（snapshot），那么测试可以跳过 setup 链：

```
Plan: [provider-add, model-add, prototype-add, session-add]

当前做法（每次都从 S₀ 开始）：
  1. provider add  → S₁
  2. model add     → S₂
  3. prototype add → S₃
  4. session add   → 测这个

优化后（从 S₃ 的快照开始）：
  1. 加载 S₃ 快照  → 直接到达 S₃
  2. session add   → 测这个
```

### 6.3 快照的实现

Sumeru Host 的状态包含两部分：

| 状态 | 存储位置 | 快照方式 |
|------|---------|---------|
| Docker 容器 | Docker daemon | `docker commit` → image |
| Host 注册表 | SQLite 文件 | 复制 .sqlite 文件 |

完整快照 = Docker image + SQLite dump。

或者更简单的方案：**让 Host 运行在 Docker 内**，这样 `docker commit`
就能捕获完整状态（包括 SQLite）。

### 6.4 Snapshot 命名约定

```
sumeru/test-state:provider-added
sumeru/test-state:model-added
sumeru/test-state:prototype-added
sumeru/test-state:session-created
```

---

## 7 与 atest 的关系

### 7.1 atest 是路径的执行

atest YAML 是测试树上一条路径的**具体执行**。当前 atest 是手写的，
未来可以从树声明自动生成。

### 7.2 分层

```
声明层（YAML/Tree）           → 定义 TestCase、状态、路径
生成层（tool）               → 从声明生成 atest YAML
执行层（agentic-test-runner） → 执行 atest，产出 JSONL trace
```

### 7.3 扩展方向

1. **声明式 TestCase** — 在 YAML 中定义 (id, S_pre, I, Judge)
2. **路径组合** — 定义 TestPlan 时只列出 TestCase id 序列
3. **自动生成 atest** — 工具将 TestPlan 展开为 atest YAML
4. **状态快照** — 可选优化，跳过已知状态的 setup

---

## 8 开放问题

1. **Judge 的表达** — 如何声明式地描述 Judge？当前 atest 用 regex/jsonata/llm，
   但状态树模型里 Judge 需要验证 S_post 的属性，可能需要更丰富的断言语言。

2. **参数化** — TestCase 如何参数化？比如 `provider-add` 可以有不同的 name，
   参数化后 S_pre 的表达会更复杂。

3. **并行执行** — 树的不同分支能否并行执行？比如 persona-add 和 provider-add
   互不依赖，可以并行。但当前 atest 是串行的。

4. **状态回退** — 某些 TestCase 需要"回到"之前的状态（比如测试 delete 后
   再测试 add），如何在树模型中表达？

5. **快照的维护成本** — 每次代码变更后，快照可能需要重建。如何自动化？

6. **与现有 atest 的迁移** — 现有 43 个 atest 如何映射到树模型？
