# 树状行为测试系统（btest）

> 状态：理论讨论，尚未进入工程实施

## 1 动机

当前 atest 是**扁平的执行路径**——每个 YAML 文件包含一条完整的 setup → action → verify 链，
路径之间无法复用，状态无法共享。

本文定义一个**树状测试系统**：

- **节点** = 一个测试用例（执行一条命令 + 判定）
- **边** = 状态依赖（子节点依赖父节点执行后的状态）
- **状态隔离** = `docker commit` 产出的 image tag

目标：

- 最大限度复用前置状态（一个 setup 被多个子节点共享）
- 失败隔离（一个节点失败，只影响其子树）
- 资源可控（DFS 遍历，只保留当前路径上的 image）

---

## 2 基础模型

### 2.1 系统

一个系统是**状态空间 S** 和**变换集合 T** 的组合：

```
System = (S₀, {Tᵢ})

S₀  : 初始状态（base image tag）
Tᵢ  : 变换（transition），接收输入，改变状态，产生输出
```

每个变换 Tᵢ 的形式：

```
Tᵢ: (S, Iᵢ) → (S', Oᵢ)

S   : 变换前的系统状态（docker image tag）
Iᵢ  : 输入（CLI 命令 / HTTP request）
S'  : 变换后的系统状态（新的 docker image tag）
Oᵢ  : 输出（stdout, stderr, exit_code / HTTP response）
```

### 2.2 状态的隐晦性

系统状态 S 是**全局的、隐晦的**。我们无法直接观测 S 的完整内容，
只能通过探针（probe）来刺探 S 的部分信息。

这意味着：我们无法验证两个状态是否等价，因为我们无法全量比较 S。

### 2.3 树视角

由于无法验证状态等价性，采用**树视角**：

- 状态 S 由其**到达路径**唯一标识
- S = T[]，即从 S₀ 到达当前状态所经过的变换序列
- 空序列 [] 代表初始状态 S₀

```
S₀         = []                        (base image tag)
S₁         = [T_provider-add]          (commit 后的 tag)
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
TestCase = (id, parent, command, mutator_judge, probes)

id              : 用例标识
parent          : 父节点 id（根节点的 parent 为空）
command         : 被测命令（mutator）
mutator_judge   : 对命令输出的判定（exit_code / stdout 匹配）
probes          : 0~N 个状态探针（每个探针包含 command + state_judge）
```

TestCase 执行后，如果通过，产出一个新的 image tag：

```
S_post = docker commit(S_pre_container)
```

### 3.2 两阶段判定

每个 TestCase 有**两个判定阶段**：

| 阶段 | 时机 | 判什么 | 怎么判 |
|:-----|:-----|:-------|:-------|
| **Mutator Judge** | 命令执行后 | 命令本身是否正确执行 | 匹配 exit_code、stdout 内容 |
| **State Judge** | commit 后 | 系统状态是否符合预期 | 从新 tag 启动探针容器，执行探测命令 |

**Mutator Judge**：轻量，直接检查命令的 stdout/stderr/exit_code。

```yaml
mutator_judge:
  exit_code: 0
  stdout_contains: "provider 'openrouter' added"
```

**State Judge**：从 post-condition tag 启动独立容器（一次性），执行任意探测命令。
探针容器是**用完即弃的副本**，可以做任何操作（包括 mutable），不影响原始状态。

```yaml
probes:
  - command: "sumeru provider list"
    judge:
      stdout_contains: "openrouter"
  - command: "cat /data/providers.json"
    judge:
      stdout_json:
        "$.providers[0].name": "openrouter"
```

### 3.3 探针容器

探针跑在从 committed tag 启动的**独立容器**里：

| 属性 | 说明 |
|:-----|:-----|
| 生命周期 | 用完即销毁 |
| 隔离性 | 完全隔离，探针的任何操作不影响原始状态 |
| 能力 | 可执行任意命令（包括 mutable） |
| 数量 | 0~N 个，串行执行（省内存） |

探针容器串行执行，峰值内存 = 1 个 mutator 容器 + 1 个探针容器。

---

## 4 测试树

### 4.1 结构

所有 TestCase 构成一棵**以 S₀（base image tag）为根的树**。

```
S₀ (base image tag)
├── provider-add
│   ├── model-add
│   │   ├── prototype-add
│   │   │   ├── session-add
│   │   │   │   ├── session-stop
│   │   │   │   └── session-remove
│   │   │   └── prototype-update
│   │   └── model-update
│   └── provider-update
├── persona-add
│   └── persona-remove
└── help-command          (无子节点，不产生 commit)
```

### 4.2 失败传播

如果一个 TestCase 的 **Mutator Judge 失败**，则其**整个子树不可达**。

如果一个 TestCase 的 **State Judge 失败**（探针判定不通过），
当前节点标记为 FAIL，但不影响子树执行（因为 mutator 本身是成功的，
状态已正确变换，只是验证不符合预期——这种情况应该报告但不阻断）。

> **设计决策**：State Judge 失败是否阻断子树？
> - **不阻断**（当前方案）：状态已变换，子节点可以继续
> - **阻断**（备选）：状态验证失败意味着后续测试基于不可信的状态

### 4.3 森林

如果有多棵独立的树（互不依赖的测试路径），它们构成一个**森林**。
所有树的根共享同一个 base image tag（S₀）。

实际上可以视为一个虚拟根节点，所有实际根都是它的子节点。

---

## 5 执行模型

### 5.1 DFS 遍历

采用**深度优先遍历**执行测试树。核心原则：**只保留当前 DFS 路径上的 image tag**。

### 5.2 执行流程

```
execute(node, parent_tag):
  # 步骤 1: 从 pre-condition tag 启动容器
  container = docker run parent_tag

  # 步骤 2: 在容器内执行被测命令
  output = exec(container, node.command)

  # 步骤 3: Mutator Judge — 验证命令输出
  if !mutator_judge(output):
    report FAIL
    return

  # 步骤 4: 是否需要 commit？
  need_commit = node.has_children OR node.has_probes

  if need_commit:
    new_tag = docker commit container   # 产生 post-condition tag

  # 步骤 5-6: State Judge — 从新 tag 启动探针容器
  if node.has_probes:
    probe_container = docker run new_tag
    for probe in node.probes:
      probe_output = exec(probe_container, probe.command)
      if !state_judge(probe_output):
        report FAIL
    docker rm probe_container

  # 步骤 7: 继续执行子节点
  if node.has_children:
    for child in node.children:
      execute(child, new_tag)
    docker rmi new_tag   # 所有子节点跑完，删掉这个 tag

  docker rm container
```

### 5.3 Commit 策略

**不是每个 test case 都需要 commit。** 只在以下情况 commit：

| 条件 | 是否 commit | 原因 |
|:-----|:------------|:-----|
| 有子节点 | ✅ | 子节点需要从 post-condition tag 启动 |
| 有探针 | ✅ | 探针需要从 post-condition tag 启动独立容器 |
| 叶子节点 + 无探针 | ❌ | 不需要保留状态，直接执行+判定即可 |

### 5.4 资源消耗

| 资源 | 消耗 | 原因 |
|:-----|:-----|:-----|
| **磁盘** | O(路径深度) | 只保留当前 DFS 路径上的 tag，已完成的 tag 立即删除 |
| **内存** | 1 mutator + 1 probe | 探针串行执行，峰值两个容器 |
| **Docker 层数** | base 层数 + 路径深度 | `docker commit` 每次只增加 **1 层**（overlay2 增量层），不会增加多层 |
| **时间** | ~5-10 秒/case | 容器启动 + 命令执行 + commit，43 个 case ≈ 5-7 分钟 |

**Docker 层深度**：base image 通常 5-10 层，路径深度通常 < 20，总计 < 30 层，
远低于 Docker overlay2 的 127 层上限。不存在层深度问题。

---

## 6 与 Docker 的关系

### 6.1 黑盒视角

测试系统是**黑盒**的——它只关心 CLI 命令和输出，不关心被测系统的内部实现。
`docker commit` 是测试框架的基础设施能力，不是被测系统特有的。

### 6.2 Docker Image Chain

测试框架不依赖被测系统的 Docker image chain。它只需要一个 base image tag
作为入口（S₀），然后通过 `docker commit` 构建自己的状态链。

```
被测系统的 image chain:
  sumeru/base:dev → sumeru/hermes:dev → ...

测试框架的 tag chain（运行时动态产生）:
  base_tag → tag_provider-added → tag_model-added → ...
```

### 6.3 Tag 命名

测试过程中产生的 tag 使用统一前缀，方便清理：

```
btest/ephemeral:<node-id>
```

测试结束后（正常或异常），清理所有 `btest/ephemeral:*` tag。

---

## 7 声明格式（草案）

### 7.1 TestCase

```yaml
- id: provider-add
  parent: null                    # 根节点
  command: "sumeru provider add openrouter --api-base https://openrouter.ai/api/v1"
  mutator_judge:
    exit_code: 0
    stdout_contains: "added"
  probes:
    - command: "sumeru provider list"
      judge:
        stdout_contains: "openrouter"

- id: model-add
  parent: provider-add
  command: "sumeru model add claude-4-sonnet --provider openrouter"
  mutator_judge:
    exit_code: 0
  probes:
    - command: "sumeru model list"
      judge:
        stdout_contains: "claude-4-sonnet"
```

### 7.2 环境变量

TestCase 的 command 和 probe command 中可以引用环境变量，
用于隔绝 token、密钥等敏感信息：

```yaml
- id: provider-add
  command: "sumeru provider add openrouter --api-key $OPENROUTER_API_KEY"
```

环境变量在运行时从 `.env` 文件或 shell 环境注入，不是参数化。

### 7.3 Judge 表达

Mutator Judge 和 State Judge 支持以下判定方式：

| 方式 | 示例 | 说明 |
|:-----|:-----|:-----|
| `exit_code` | `exit_code: 0` | 精确匹配退出码 |
| `stdout_contains` | `stdout_contains: "added"` | stdout 包含子串 |
| `stdout_regex` | `stdout_regex: "provider \\w+ added"` | stdout 匹配正则 |
| `stdout_json` | `stdout_json: {"$.name": "foo"}` | JSON 路径断言 |
| `stderr_contains` | `stderr_contains: "warning"` | stderr 包含子串 |

---

## 8 与 atest 的关系

### 8.1 定位

btest 不是 atest 的替代品，而是面向不同场景的兄弟工具：

| 工具 | 场景 | 模型 |
|:-----|:-----|:-----|
| **atest** | 扁平的、无状态的 API/CLI 测试 | YAML 文件 = 独立路径 |
| **btest** | 树状的、状态化的行为测试 | 节点 = 有向边，状态 = tag chain |

### 8.2 分层

```
声明层（YAML Tree）       → 定义 TestCase、父子关系、Judge
执行层（btest runner）     → DFS 遍历，docker commit/rmi，判定
```

不需要"从树生成 atest"这一层——btest 直接执行树声明。

---

## 9 开放问题

1. **State Judge 失败是否阻断子树？** 当前方案是不阻断（只报告），
   但某些场景可能需要阻断（状态不可信时不应继续）。

2. **错误恢复** — 如果 `docker commit` 失败（磁盘满、Docker daemon 崩溃），
   如何恢复？是从头重跑还是从最近的 tag 恢复？

3. **并行分支** — 当前 DFS 是串行的。如果两个分支完全独立
   （比如 persona-add 和 provider-add），理论上可以并行。
   但并行意味着同时保留多个路径上的 tag，磁盘消耗增加。
   是否值得？

4. **Base image 准备** — S₀ 的 base image 如何准备？
   是否需要一个 `before_all` hook 来构建/拉取 base image？

5. **CI/CD 集成** — btest 的输出格式是什么？
   如何与 CI 系统集成（JUnit XML、GitHub Checks）？
