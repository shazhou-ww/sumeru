---
scenario: "Hot-switch model config on resume (refueling pattern)"
feature: session-resume-model
tags: [host, session, resume, model, refuel, v3]
---

## Given
- Session `$SID` exists with status `idle`
- Current model config: `{provider:"anthropic", name:"claude-sonnet-4-20250514", apiKey:"sk-ant-old..."}`
- Adapter session exists (was previously initialized)

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "content":"继续完成代码重构",
    "model":{
      "provider":"anthropic",
      "name":"claude-sonnet-4-20250514",
      "apiKey":"sk-ant-fresh-key-999"
    }
  }'
```

## Then
- HTTP 202 (message accepted)
- `record.model` is replaced with new model config
- `modelConfigChanged()` detects apiKey difference → returns true
- Adapter session is invalidated: `runtime.session.stdin.end()`, `runtime.session = null`
- New adapter process is spawned with fresh `initConfig` containing updated model
- Adapter receives `{"type":"init","value":{...}}` with new model, then `{"type":"message",...}`
- Session resumes in `running` state with new model credentials

## Given (switch to custom provider — refueling exhausted endpoint)
- Session `$SID` exists with status `idle`
- Current model uses OpenRouter endpoint that hit rate limits

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "content":"resume task with backup provider",
    "model":{
      "provider":{
        "name":"backup-llm",
        "endpoint":"https://backup.api.example.com/v1",
        "apiType":"openai"
      },
      "name":"gpt-4o"
    }
  }'
```

## Then
- HTTP 202
- Model config updated to custom provider with endpoint + apiType
- `modelConfigChanged()` detects provider object difference → true
- Adapter session invalidated and re-initialized with new provider config
- `initConfig.model` reflects: `{provider:{name:"backup-llm",endpoint:"...",apiType:"openai"}, name:"gpt-4o", apiKey:null}`
- Agent continues task seamlessly with different backend

## Given (same model — no invalidation)
- Session `$SID` with model `{provider:"anthropic", name:"claude-sonnet-4-20250514", apiKey:"sk-ant-key"}`

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "content":"keep going",
    "model":{"provider":"anthropic","name":"claude-sonnet-4-20250514","apiKey":"sk-ant-key"}
  }'
```

## Then
- HTTP 202
- `modelConfigChanged()` returns false (provider, name, apiKey all identical)
- Adapter session is NOT invalidated — warm session reused
- No re-init overhead, message delivered immediately to existing adapter

## Given (invalid model body)
- Session `$SID` with status `idle`

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"test","model":{"provider":"anthropic"}}'
```

## Then
- HTTP 400 — `name` field is required and must be non-empty string
- `parseMessageBody` returns null when `model.name` is missing
- Session state unchanged

## Notes
- "Refueling" pattern: 当一个 API key 的额度用完时，通过 model hot-switch 切换到新的 key 或 provider，无需销毁重建 session
- `modelConfigChanged` (line 776-784): compares `name`, JSON-stringified `provider`, and `apiKey`
- `invalidateAdapterSession`: ends stdin, nulls session, rebuilds `initConfig` via `buildInitConfig`
- Model switch triggers adapter re-init but preserves container state (filesystem, project files)
- `resolveModelConfig` processes the raw model body against host config defaults
- apiKey 可以为 null — 此时 adapter 从环境变量读取 (适用于 env hot-injection 配合使用)
