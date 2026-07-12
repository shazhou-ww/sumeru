---
id: tc-snapshot-readability
spec: session-commands
tags: [e2e, session, snapshot, output]
prerequisites:
  - Host running
  - Active session with sarsapa prototype
---

# Snapshot Output Readability

## Steps

1. 创建 session：
   ```bash
   SID=$(sumeru session add sarsapa | awk '{print $3}')
   ```

2. 执行 snapshot：
   ```bash
   sumeru session snapshot $SID test-snapshot
   ```

## Verify

输出格式：
```
Snapshot created
  Name:  test-snapshot
  Image: sumeru/test-snapshot:dev
```

- 不是紧凑的单行 `test-snapshot sumeru/test-snapshot:dev`
- 包含 `Snapshot created` 标题
- Name 和 Image 各占一行，缩进对齐

## Cleanup

```bash
sumeru session rm $SID
sumeru prototype rm test-snapshot
docker rmi sumeru/test-snapshot:dev
```
