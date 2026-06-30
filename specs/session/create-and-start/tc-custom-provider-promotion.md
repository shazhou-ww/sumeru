---
id: tc-custom-provider-promotion
spec: create-and-start
tags: [e2e, docker, provider, config]
prerequisites:
  - Sumeru host running with host.yaml that has a known provider with custom baseUrl
  - sumeru/hermes:dev image built from latest main (must include promoteIfCustomEndpoint)
  - LLM endpoint (e.g. copilot-bridge) reachable from container via host.docker.internal
---

# Custom Provider Promotion

验证当 host.yaml 里的 known provider (anthropic/openai/openrouter) 配了自定义 baseUrl 时，
adapter 会自动将其 promote 为 CustomProvider，生成正确的 hermes config.yaml。

这是 #173 修复的核心场景。根因链：
1. known provider 有 baseUrl → 必须 promote 为 custom provider（否则 hermes 忽略 baseUrl）
2. hermes custom_providers 字段名：`base_url`（非 endpoint）、`api_mode: chat_completions`（非 api_type）
3. base_url 必须带 `/v1` 后缀

## Setup

1. 确认 host.yaml 配置含自定义 baseUrl：
   ```bash
   grep -A2 "baseUrl" /tmp/sumeru-e2e/host.yaml
   ```
   → 应显示类似 `baseUrl: http://host.docker.internal:4141`

2. 确认 compose.yaml 有 extra_hosts 映射：
   ```bash
   grep "host.docker.internal" /tmp/sumeru-e2e/prototypes/hermes/compose.yaml
   ```
   → 应显示 `host.docker.internal:host-gateway`

## Steps

1. 创建 session：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with exactly: Hello World!",
       "model": "claude-opus-4.6"
     }'
   ```
   → 记录 `$SID`

2. Poll 直到 idle：
   ```bash
   for i in $(seq 1 24); do
     STATUS=$(curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status')
     [ "$STATUS" != "running" ] && break
     sleep 5
   done
   ```

3. 检查容器内生成的 hermes config.yaml：
   ```bash
   CID=$(docker ps --filter "label=sumeru.session=$SID" -q)
   docker exec $CID cat /home/node/.hermes/config.yaml
   ```

4. 获取 turns 确认 agent 实际工作了：
   ```bash
   curl -s "http://127.0.0.1:7901/sessions/$SID/turns" | jq '.value'
   ```

## Expected

- [ ] Step 1 返回 201，status = running
- [ ] Step 2 最终 status = `idle`（非 error）
- [ ] Step 3 config.yaml 包含 `custom_providers` 块（非 `providers`）
- [ ] Step 3 `base_url` 字段值以 `/v1` 结尾
- [ ] Step 3 `api_mode` = `chat_completions`
- [ ] Step 3 provider name ≠ `anthropic`（已被 promote，应为生成的 custom 名称）
- [ ] Step 4 至少 1 个 turn，turnCount ≥ 1
- [ ] Step 4 assistant 回复内容包含 "Hello World"（不是 API error message）

## Failure Signals

- config.yaml 用 `endpoint` 而非 `base_url` → adapter dist/ 未重建，rebuild Docker image
- config.yaml 没有 `custom_providers` → `promoteIfCustomEndpoint()` 未生效
- 404 API error in turns → base_url 缺 `/v1` 后缀
- turnCount = 0 → ACP 通信失败，检查容器 errors.log
