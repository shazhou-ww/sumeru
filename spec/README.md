# Sumeru Integration Test Specs

## 方法论

测试用例树映射**用户旅程**，不枚举功能菜单。

1. **先定主线** — 用户从"空系统"到"完成核心任务"的最短路径
2. **再挂支线** — 每个主线节点的修饰操作（CRUD 的其他三项、参数变体、异常路径）
3. **支线的支线** — 支线的变体和边界情况

这样做的收益：
- 主线全绿 = 产品可用，天然成为 CI gate
- 支线挂载点明确，fixture 可复用（子目录继承父目录的前置状态）
- 新增测试用例时，先问"它挂在哪条主线的哪个节点"

## 主线

```
add-provider → add-model → add-prototype → create-session → send-message
    → send-append → session-reset → send-after-reset → session-snapshot
        → session-stop → session-remove
```

| # | 节点 | CLI 命令 | 状态 |
|---|------|---------|------|
| 1 | add-provider | `sumeru provider add` | ✅ 已实现 |
| 2 | add-model | `sumeru model add` | ✅ 已实现 |
| 3 | add-prototype | `sumeru prototype add` | ✅ 已实现 |
| 4 | create-session | `sumeru session add` | ✅ 已实现 |
| 5 | send-message | `sumeru session send` | ✅ 已实现 |
| 6 | send-append | `sumeru session send` (追加) | ✅ 已实现 |
| 7 | session-reset | `sumeru session reset` | ⬜ 待补 |
| 8 | send-after-reset | `sumeru session send` | ⬜ 待补 |
| 9 | session-snapshot | `sumeru session snapshot` | ⬜ 待补 |
| 10 | session-stop | `sumeru session stop` | ✅ 已实现（作为支线） |
| 11 | session-remove | `sumeru session remove` | ✅ 已实现（作为支线） |

## 当前目录结构

```
spec/
├── add-provider/                              # 主线 ①
│   ├── update-provider/                       #   支线
│   ├── remove-provider/                       #   支线
│   └── add-model/                             # 主线 ②
│       ├── update-model/                      #   支线
│       ├── remove-model/                      #   支线
│       │   └── remove-provider-in-use/        #     支线的支线：删除被引用的 provider
│       └── add-prototype-with-model/          # 主线 ③
│           ├── update-prototype/              #   支线
│           ├── update-multiple-fields/        #   支线
│           ├── remove-prototype/              #   支线
│           └── create-session/                # 主线 ④
│               ├── get-session/               #   支线
│               ├── list-sessions/             #   支线
│               ├── delete-session/            #   支线（= 主线 ⑪）
│               ├── execute-commands/          #   支线
│               ├── create-without-task/       #   支线
│               │   └── send-to-idle/          #     支线的支线
│               ├── create-multiple-sessions/  #   支线
│               │   └── paginate-list/         #     支线的支线
│               ├── stop-session/              #   支线（= 主线 ⑩）
│               │   └── resume-session/        #     支线的支线
│               └── send-message/              # 主线 ⑤
│                   └── send-append/           # 主线 ⑥
│                       ├── list-turns/
│                       ├── watch-turns/
│                       ├── paginate-turns/
│                       ├── filter-by-role/
│                       ├── filter-by-tool/
│                       ├── filter-by-time/
│                       ├── inspect-turn-structure/
│                       └── show-tool-calls/
├── create-project-dir/                        # 独立支线：项目挂载
│   └── attach-project/
│       └── read-project-file/
├── inject-secret/                             # 独立支线：密钥注入 + 各 adapter snapshot
│   ├── take-sarsapa-snapshot/
│   ├── take-hermes-snapshot/
│   ├── take-cursor-agent-snapshot/
│   ├── take-codex-snapshot/
│   └── take-claude-code-snapshot/
├── create-sarsapa-session/                    # 独立支线：sarsapa wire format
│   ├── verify-text-only-turn/
│   ├── verify-wire-tool-call-id/
│   └── verify-token-usage/
├── list-adapters/                             # 独立支线：只读查询
├── list-adapter-models/                       # 独立支线
├── get-adapter/                               # 独立支线
├── trigger-compound-errors/                   # 独立支线：异常路径
├── post-invalid-json/                         # 独立支线：API 边界
├── delete-while-running/                      # 独立支线：并发安全
└── attach-invalid-path/                       # 独立支线：输入校验
```

## 独立支线

不属于主线任何节点、但需要独立验证的场景：

| 场景 | 说明 |
|------|------|
| `create-project-dir/` | 项目目录挂载与文件读取 |
| `inject-secret/` | 密钥注入 + 各 adapter snapshot 验证 |
| `create-sarsapa-session/` | sarsapa adapter wire format 细节 |
| `list-adapters/` | adapter 注册表只读查询 |
| `list-adapter-models/` | adapter 内置模型查询 |
| `get-adapter/` | 单个 adapter 详情 |
| `trigger-compound-errors/` | 组合错误场景 |
| `post-invalid-json/` | API 输入校验 |
| `delete-while-running/` | 运行中删除的并发安全 |
| `attach-invalid-path/` | 非法项目路径校验 |

## 待补主线节点

| 节点 | 挂载点 | 说明 |
|------|--------|------|
| `session-reset/` | `create-session/` 下 | 重置会话上下文 |
| `send-after-reset/` | `session-reset/` 下 | 验证重置后可继续对话 |
| `session-snapshot/` | `create-session/` 下 | 固化对话经验为新 prototype |

> `session-stop/` 和 `session-remove/` 已作为支线存在于 `create-session/` 下（分别是 `stop-session/` 和 `delete-session/`），功能上覆盖主线 ⑩⑪。

## 约定

- 目录名 = 动词短语（描述做了什么），不加前缀
- 子目录继承父目录的前置状态（fixture 层层叠加）
- 主线节点和支线节点在 YAML 格式上无差别，主线由本文档定义
- 新增 spec 时，先确定挂载点，再创建目录
