---
scenario: "maxInstances resource limit rejects creation with 503"
feature: host-instances
tags: [host, docker, worker, resource-limit, walkthrough, S7]
---

## Given
- `host.yaml` configured with `resources.maxInstances: 2`
- Master `inst_0` exists (does NOT count toward worker limit)

## When
```bash
# Create worker #1
curl -s -w "%{http_code}" -X POST http://127.0.0.1:7901/instances \
  -H 'Content-Type: application/json' -d '{"prototype":"claude-code"}'

# Create worker #2
curl -s -w "%{http_code}" -X POST http://127.0.0.1:7901/instances \
  -H 'Content-Type: application/json' -d '{"prototype":"claude-code"}'

# Create worker #3 (should fail)
curl -s -w "%{http_code}" -X POST http://127.0.0.1:7901/instances \
  -H 'Content-Type: application/json' -d '{"prototype":"claude-code"}'
```

## Then
- Worker #1: HTTP 201 ✓
- Worker #2: HTTP 201 ✓
- Worker #3: HTTP 503, `{"type":"@sumeru/error","value":{"error":"resource_exhausted","message":"Maximum running instances reached"}}`
- Master `inst_0` does NOT consume a worker slot (code filters by `id !== MASTER_INSTANCE_ID`)
- Only instances with `status === "running"` are counted (stopped instances don't block)

## Notes
- The limit applies to running workers only (stopped/deleted don't count)
- After DELETE-ing a worker, a new one can be created within the limit
- Error type is `resource_exhausted` with HTTP 503 (Service Unavailable)
