---
tc: init scaffold 写入 AGENTS.md 和 skills
spec: adapter-codex-stream-parser
tags: [adapter, codex, init, scaffold]
status: PASS
---

# TC: init → AGENTS.md + skills scaffold

## Setup

创建临时目录，构造 `AdapterInitConfig`。

## Steps

1. 调用 `adapter.init(config)`
2. 检查 homeDir 下文件

## Expected

- [ ] `AGENTS.md` 文件存在
- [ ] 每个 skill 的内容被写入对应文件
- [ ] adapter 可正常调用 `handle()` 而不报初始化错误

## Covered by

`packages/adapter-codex/tests/adapter.test.ts`
— `"init writes AGENTS.md and skills under the configured home dir"` test
