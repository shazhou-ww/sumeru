---
scenario: "DELETE /instances/:id stops container and removes instance"
feature: host-instances
tags: [host, docker, worker, delete, lifecycle, walkthrough, S7]
---

## Given
- Worker instance `$INST` exists and is running (container active)

## When
```bash
# Delete the instance
curl -s -w "%{http_code}" -X DELETE "http://127.0.0.1:7901/instances/${INST}"

# Verify container removed
docker ps -a --format "{{.Names}}" | grep inst

# Verify instance list
curl -s http://127.0.0.1:7901/
```

## Then
- Delete: HTTP 204
- `docker ps -a` shows no container for this instance
- GET / instance list no longer includes `$INST`
- Only `inst_0` (master) remains

## Notes
- Delete triggers `docker compose down` which removes the container
- Instance state is fully cleaned up (memory + any persisted record)
- Subsequent requests to this instance ID return 404
