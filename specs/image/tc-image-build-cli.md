---
id: tc-image-build-cli
spec: image-build
tags: [e2e, image, cli, build, docker]
prerequisites:
  - "[e2e-prerequisites](../e2e-prerequisites.md) 已完成"
  - Host running on test port
  - Docker daemon available
  - Monorepo packages built (`pnpm run build`)
---

# `sumeru image build` CLI 命令

验证 CLI 的 image 构建和注册流程。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/ | jq '.value.status'
   ```

2. 确认 docker daemon 可用：
   ```bash
   docker info > /dev/null 2>&1 && echo "ok"
   ```

3. 确认 packages 已 build：
   ```bash
   ls packages/sarsapa/dist/main.js && echo "ok"
   ```

## Steps

1. 构建 sarsapa image（最小、最快）：
   ```bash
   SUMERU_PORT=$SUMERU_PORT sumeru image build tc-sarsapa --agent sarsapa --adapter ./packages/sarsapa
   ```

2. 确认 docker image 存在且 tag 正确：
   ```bash
   docker images sumeru/tc-sarsapa:dev --format '{{.Repository}}:{{.Tag}}'
   ```

3. 确认 image 已注册到 host：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/images/tc-sarsapa | jq '.value.name'
   ```

4. 验证注册数据完整性：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/images/tc-sarsapa | jq '{name: .value.name, dockerfile: .value.dockerfile, has_digest: (.value.digest | length > 0), has_builtAt: (.value.builtAt | length > 0)}'
   ```

5. 测试错误路径 — 不存在的 agent type：
   ```bash
   SUMERU_PORT=$SUMERU_PORT sumeru image build bad --agent nonexistent --adapter ./packages/sarsapa 2>&1; echo "exit: $?"
   ```

6. 测试错误路径 — 不存在的 adapter 路径：
   ```bash
   SUMERU_PORT=$SUMERU_PORT sumeru image build bad --agent sarsapa --adapter ./nonexistent 2>&1; echo "exit: $?"
   ```

## Expected

- [ ] Step 1 输出 `built sumeru/tc-sarsapa:dev` + `registered image tc-sarsapa`，exit 0
- [ ] Step 2 输出 `sumeru/tc-sarsapa:dev`
- [ ] Step 3 返回 `"tc-sarsapa"`
- [ ] Step 4 返回 `{name: "tc-sarsapa", dockerfile: "packages/sarsapa/Dockerfile", has_digest: true, has_builtAt: true}`
- [ ] Step 5 exit 非 0，message 含 `Unsupported agent type`
- [ ] Step 6 exit 非 0，报错含 path 相关信息

## Cleanup

```bash
docker rmi sumeru/tc-sarsapa:dev 2>/dev/null
curl -s -X DELETE http://127.0.0.1:$SUMERU_PORT/images/tc-sarsapa
```

## Failure Signals

- Step 1 报 `POST not allowed` → host 跑的是旧版（需重启 host 用新 dist）
- Step 1 报 `Could not find monorepo root` → CLI 不在 sumeru 仓库内运行
- Step 3 返回 404 → build 成功但注册失败（host 不可达或路由缺失）

## Notes

- 本地 adapter（`./` 开头）自动 tag 为 `sumeru/<name>:dev`
- npm adapter（`@sumeru/adapter-xxx@0.3.0`）tag 为 `sumeru/<name>:0.3.0`（未来支持）
- `--agent` 决定 base Dockerfile：sarsapa/hermes/codex/claude-code/cursor-agent
