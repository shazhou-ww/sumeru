---
id: resume-after-restart
tags: [e2e, session, resume, persistence, sarsapa]
---

# Session Resume After Host Restart

Host 重启后，sarsapa session 通过 JSONL 持久化恢复对话上下文。

## 机制

### Adapter 协议扩展

`AdapterImpl` 新增可选 `resume?(): boolean | Promise<boolean>`：
- 返回 `true` → adapter 已从持久化数据恢复，发 `ready`，跳过 `init`
- 返回 `false` / 未实现 → 等待 Host 发 `init`

### Host 行为

- 新 session（`initVersion === null`）：发 `init`
- 已初始化 session（`initVersion !== null`）：不发 `init`，等 adapter 自行 resume

### Sarsapa JSONL 持久化

路径：容器内 `/workspace/.sarsapa/session.jsonl`

```jsonl
{"type":"init","system":"...","model":{...}}
{"role":"user","content":"hello","toolCalls":null,"toolCallId":null}
{"role":"assistant","content":"Hi!","toolCalls":null,"toolCallId":null}
```

- `init` 时写入第一行
- 每个 turn（user/assistant/tool）追加一行
- 重启时读取 → 重建 Conversation + initConfig
