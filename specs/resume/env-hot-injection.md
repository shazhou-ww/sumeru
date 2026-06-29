---
scenario: "Hot-inject environment variables into session via resume message"
feature: session-resume-env
tags: [host, session, resume, env, docker, v3]
---

## Given
- Session `$SID` exists with status `idle`
- Session was created with env `{"API_TOKEN":"old_token","DB_HOST":"db.local"}`
- Container is running with those environment variables

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "content":"用新的凭证重新运行部署脚本",
    "env":{"API_TOKEN":"new_token_xyz","DEPLOY_ENV":"staging"}
  }'
```

## Then
- HTTP 202 (message accepted)
- `record.sessionEnv` is updated: merge semantics, not replace
  - `API_TOKEN` → `"new_token_xyz"` (overwritten)
  - `DB_HOST` → `"db.local"` (preserved from original)
  - `DEPLOY_ENV` → `"staging"` (newly added)
- Next `transport.exec()` call passes merged env via `docker exec -e` flags
- Environment is injected at **container process level**, NOT into agent context/prompt
- Adapter subprocess inherits the updated env on next exec spawn
- Session transitions to `running`, message is delivered normally

## Given (env validation)
- Session `$SID` exists with status `idle`

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"test","env":{"KEY":123}}'
```

## Then
- HTTP 400 with error `{"ok":false,"error":{"code":"invalid_request","message":"Body must include a non-empty \"content\" string"}}`
- All env values must be strings; non-string values cause `parseMessageBody` to return null
- Session state is unchanged

## Given (env is null/omitted)
- Session `$SID` exists with status `idle`

## When
```bash
curl -s -X POST "http://127.0.0.1:7901/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"continue without env changes"}'
```

## Then
- HTTP 202
- `record.sessionEnv` is unchanged (env merge is skipped when `body.env === null`)
- Existing environment from session creation is preserved for next exec

## Notes
- `submitMessage` at line 269-273: iterates `body.env` entries and merges into `record.sessionEnv`
- `ensureAdapterReady` passes `record.sessionEnv` to `transport.exec()` — this becomes `docker exec -e KEY=VALUE`
- Env hot-injection 不会重启容器 — 仅影响下一次 adapter exec 的环境变量
- Use case: rotating API keys, injecting ephemeral credentials, switching deployment targets
- The env is NOT passed as part of the adapter init config (not visible to model instructions)
