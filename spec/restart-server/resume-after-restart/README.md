# 重启后恢复 Session

## Precondition

- Server 正在运行
- 完整资源链已创建（provider → model → prototype）
- Session 已创建（SID 来自 task='Survive restart'）

## Postcondition

- Server 重启成功
- Session 列表仍然包含重启前创建的 Session
- Session 数据从 SQLite 恢复

## 验证方法

```bash
sumeru server restart && sleep 3 && sumeru session list
# 期望: 包含 ses_ 或 session 关键词
```

## 父节点

- [restart-server](../README.md)
