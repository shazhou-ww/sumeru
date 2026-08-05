# Adapter Installation 重构 — Treespec 主线测试设计

## 主线流程

```
1. install-adapter          — sumeru adapter add → 默认 prototype + image
2. create-session-a         — 从默认 prototype 创建 session A（idle）
3. configure-snapshot-a     — 给 session A 配 instruction/model → snapshot → prototype A
4. create-session-b         — 从 prototype A 创建 session B
5. send-secret              — 向 session B 发消息（带 secret code）
6. snapshot-b               — 从 session B snapshot → prototype B
7. ├── session-c-reset      — 从 prototype B 创建 session C（reset）→ 问 secret → 不知道
   └── session-c-skip-reset — 从 prototype B 创建 session C（--skip-reset）→ 问 secret → 知道
       └── trace-turns      — 验证 --trace 能追溯到 session B 的 turns
8. remove-sessions          — 移除所有 session
9. remove-prototypes        — 移除 prototype A、B（默认 prototype 由 adapter remove 处理）
```

## 测试树结构

```
S₀ (base image — 无 adapter)
│
├── install-adapter — sumeru adapter add /app/packages/sarsapa
│   │  [postcon: verify-adapter-installed]
│   │  [postcon: verify-default-prototype-exists]
│   │
│   ├── adapter-list — 列出已安装 adapter
│   ├── adapter-get — 获取 adapter 详情
│   ├── adapter-add-duplicate — 重复安装 → 跳过
│   ├── adapter-remove-in-use — 有引用时拒绝删除
│   │
│   └── create-session-a — 从默认 prototype 创建 session A
│       │  [postcon: verify-session-a-exists]
│       │
│       └── configure-snapshot-a — 配 instruction + model → snapshot → prototype A
│           │  [postcon: verify-prototype-a-exists]
│           │
│           └── create-session-b — 从 prototype A 创建 session B
│               │  [postcon: verify-session-b-exists]
│               │
│               └── send-secret — 发消息 "Remember secret: ALPHA-7742"
│                   │  [postcon: verify-secret-in-turns]
│                   │
│                   └── snapshot-b — snapshot → prototype B
│                       │  [postcon: verify-prototype-b-exists]
│                       │
│                       ├── session-c-reset — 从 prototype B 创建 session C（reset）
│                       │   │  → 问 "What is the secret?" → 回答不包含 ALPHA-7742
│                       │   [postcon: verify-secret-forgotten]
│                       │
│                       └── session-c-skip-reset — 从 prototype B 创建 session C（--skip-reset）
│                           │  → 问 "What is the secret?" → 回答包含 ALPHA-7742
│                           [postcon: verify-secret-remembered]
│                           │
│                           └── trace-turns — session C turns --trace
│                               → 追溯到 session B 的 turns
│                               [postcon: verify-trace-includes-parent]
│
├── cleanup-sessions — 移除 session A、B、C
│   └── cleanup-prototypes — 移除 prototype A、B
│       └── adapter-remove — 移除 adapter（删除 image + 默认 prototype）
│
├── attach-invalid-path — 挂载非法路径 → 400
├── post-invalid-json — POST 非法 JSON → 400
└── trigger-compound-errors — 触发复合错误路径
```

## 各节点 spec.yaml 设计

### install-adapter

```yaml
description: 安装 sarsapa adapter
primary: create-session-a
branches:
  - adapter-list
  - adapter-get
  - adapter-add-duplicate
  - adapter-remove-in-use
steps:
  - type: exec
    command: sumeru adapter add /app/packages/sarsapa
    timeout: 5m
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "Installed adapter sarsapa:[a-f0-9]+"
postcon:
  - name: verify-adapter-installed
    steps:
      - type: exec
        command: sumeru adapter list --format json
        assert:
          type: regex
          conditions:
            - path: stdout
              regex: '"name":\s*"sarsapa"'
  - name: verify-default-prototype-exists
    steps:
      - type: exec
        command: sumeru prototype list --format json
        assert:
          type: regex
          conditions:
            - path: stdout
              regex: '"sumeru/base/sarsapa:'
```

### create-session-a

```yaml
description: 从默认 prototype 创建 session A
primary: configure-snapshot-a
steps:
  - type: exec
    command: |
      PROTO=$(sumeru prototype list --format json | python3 -c "
      import json,sys
      d=json.load(sys.stdin)
      for p in d['value']:
          if p['name'].startswith('sumeru/base/sarsapa'):
              print(p['name']); break")
      SID=$(sumeru session add $PROTO 2>&1 | grep -o 'ses_[A-Z0-9]*' | head -1)
      echo $SID > /tmp/session_a_id
      echo "SESSION_A=$SID PROTO=$PROTO"
    timeout: 5m
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "SESSION_A=ses_[A-Z0-9]+"
```

### configure-snapshot-a

```yaml
description: 配置 session A 的 instruction 和 model，snapshot 为 prototype A
primary: create-session-b
steps:
  - type: exec
    command: |
      SID=$(cat /tmp/session_a_id)
      # 配置 model
      sumeru provider add test-provider --api-type openai --base-url https://api.example.com 2>/dev/null || true
      sumeru model add test-model --provider test-provider --model test-model-id 2>/dev/null || true
      # 通过 session exec 写入 instruction（或通过 API 配置）
      # 然后 snapshot
      sumeru session snapshot $SID atest-proto-a 2>&1
      echo "SNAPSHOT_A=atest-proto-a"
    timeout: 120s
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "Snapshot created"
postcon:
  - name: verify-prototype-a-exists
    steps:
      - type: exec
        command: sumeru prototype get atest-proto-a --format json
        assert:
          type: regex
          conditions:
            - path: stdout
              regex: '"name":\s*"atest-proto-a"'
```

### send-secret

```yaml
description: 向 session B 发送包含 secret 的消息
primary: snapshot-b
steps:
  - type: exec
    command: |
      SID=$(cat /tmp/session_b_id)
      sumeru session send $SID "Remember this secret code: ALPHA-7742. Acknowledge it."
    timeout: 5m
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "accepted message|ALPHA"
postcon:
  - name: verify-secret-in-turns
    steps:
      - type: exec
        command: |
          SID=$(cat /tmp/session_b_id)
          sumeru session turns $SID --format json
        assert:
          type: regex
          conditions:
            - path: stdout
              regex: "ALPHA-7742"
```

### session-c-reset

```yaml
description: 从 prototype B 创建 session C（reset 模式），问 secret → 不知道
steps:
  - type: exec
    command: |
      SID=$(sumeru session add atest-proto-b --task "What is the secret code?" 2>&1 | grep -o 'ses_[A-Z0-9]*' | head -1)
      echo $SID > /tmp/session_c_reset_id
      # 等待回复，检查 turns
      sleep 5
      TURNS=$(sumeru session turns $SID --format json)
      if echo "$TURNS" | grep -q "ALPHA-7742"; then
        echo "SECRET_KNOWN=true (unexpected)"
      else
        echo "SECRET_KNOWN=false (expected — reset cleared context)"
      fi
    timeout: 5m
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "SECRET_KNOWN=false"
```

### session-c-skip-reset

```yaml
description: 从 prototype B 创建 session C（--skip-reset），问 secret → 知道
primary: trace-turns
steps:
  - type: exec
    command: |
      SID=$(sumeru session add atest-proto-b --task "What is the secret code?" --skip-reset 2>&1 | grep -o 'ses_[A-Z0-9]*' | head -1)
      echo $SID > /tmp/session_c_skip_id
      # 等待回复
      sleep 5
      TURNS=$(sumeru session turns $SID --format json)
      if echo "$TURNS" | grep -q "ALPHA-7742"; then
        echo "SECRET_KNOWN=true (expected — skip-reset preserved context)"
      else
        echo "SECRET_KNOWN=false (unexpected)"
      fi
    timeout: 5m
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "SECRET_KNOWN=true"
```

### cleanup-sessions → cleanup-prototypes → adapter-remove

```yaml
# cleanup-sessions
description: 移除所有测试 session
primary: cleanup-prototypes
steps:
  - type: exec
    command: |
      for f in /tmp/session_a_id /tmp/session_b_id /tmp/session_c_reset_id /tmp/session_c_skip_id; do
        if [ -f "$f" ]; then
          sumeru session remove $(cat $f) 2>/dev/null || true
        fi
      done
      echo "All sessions removed"
```

```yaml
# cleanup-prototypes
description: 移除测试 prototype
primary: adapter-remove
steps:
  - type: exec
    command: |
      sumeru prototype remove atest-proto-a 2>/dev/null || true
      sumeru prototype remove atest-proto-b 2>/dev/null || true
      echo "Prototypes removed"
```

```yaml
# adapter-remove
description: 移除 adapter（删除 image + 默认 prototype）
steps:
  - type: exec
    command: |
      sumeru adapter remove sarsapa
    assert:
      type: regex
      conditions:
        - path: stdout
          regex: "Removed adapter"
postcon:
  - name: verify-adapter-gone
    steps:
      - type: exec
        command: sumeru adapter list --format json
        assert:
          type: regex
          conditions:
            - path: stdout
              regex: "\\[\\]|\"value\":\\s*\\[\\]"
  - name: verify-default-proto-gone
    steps:
      - type: exec
        command: sumeru prototype list --format json
        assert:
          type: regex
            conditions:
              - path: stdout
                regex: "sumeru/base/sarsapa"  # 应该 NOT 匹配 → 需要 negative assert
```

## 验证矩阵

| 步骤 | 验证什么 | 关键断言 |
|------|----------|----------|
| install-adapter | adapter 安装 + image 构建 + 默认 prototype | `sumeru/base/sarsapa:` 出现在 prototype list |
| create-session-a | 从默认 prototype 创建 session | `SESSION_A=ses_` |
| configure-snapshot-a | snapshot 生成 prototype A | `atest-proto-a` 出现在 prototype list |
| create-session-b | 从 prototype A 创建 session | `SESSION_B=ses_` |
| send-secret | 消息包含 secret | turns 中包含 `ALPHA-7742` |
| snapshot-b | snapshot 生成 prototype B | `atest-proto-b` 出现在 prototype list |
| session-c-reset | reset 清空上下文 | turns 中**不**包含 `ALPHA-7742` |
| session-c-skip-reset | skip-reset 保留上下文 | turns 中包含 `ALPHA-7742` |
| trace-turns | origin chain 追溯 | trace 结果包含 session B 的 turns |
| cleanup-sessions | 移除所有 session | session list 为空 |
| cleanup-prototypes | 移除自定义 prototype | prototype list 只剩默认 |
| adapter-remove | 移除 adapter + image + 默认 prototype | adapter list 为空 |

## 与现有测试的关系

| 现有节点 | 处理 |
|----------|------|
| `add-provider → add-model → add-prototype` | 合并到 `configure-snapshot-a` 步骤中 |
| `create-session` | 替换为 `create-session-a`（从默认 prototype） |
| `send-message → send-append` | 替换为 `send-secret` |
| `list-turns` 等 turns 测试 | 合并到各 session 的 postcon |
| `take-snapshot → trace-turns` | 整合到主线 |
| `inject-secret` 系列 | 主线覆盖了 secret 场景 |
| `list-adapters` / `get-adapter` | 替换为 `adapter-list` / `adapter-get` |
