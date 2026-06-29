---
scenario: "POST /instances blocks until adapter container is ready"
feature: host-instances
tags: [host, docker, worker, lifecycle, walkthrough, S7]
---

## Given
- Host running with prototype `claude-code` configured (compose.yaml + manifest.yaml)
- Docker daemon accessible
- No existing worker instances

## When
```bash
START=$(date +%s%N)
curl -s -X POST http://127.0.0.1:7901/instances \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"claude-code"}'
END=$(date +%s%N)
echo "Elapsed: $(( (END - START) / 1000000 ))ms"
```

## Then
- HTTP 201
- Response envelope: `{"type":"@sumeru/instance","value":{...}}`
- `value.status` = `"running"` (not `"starting"`)
- `value.prototype` = `"claude-code"`
- Elapsed time > 500ms (proves blocking — container start + adapter ready handshake)
- `docker ps` shows a running container matching the instance ID

## Notes
- Implements #154: POST /instances now awaits `ensureAdapterReady()` before returning
- Compose up + adapter init + ready handshake typically takes ~1s
- Prior behavior was fire-and-forget (immediate 201 with starting status)
