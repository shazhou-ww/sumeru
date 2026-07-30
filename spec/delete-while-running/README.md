# 删除运行中的 Session

## Precondition

- 新建完整资源链（provider → model → prototype）
- 创建 Session 并发送长任务 `Count to 100`
- SID 存储在 `/tmp/dwr_session_id`

## Postcondition

- 正在运行的 Session 被强制删除
- 容器被清理

## 验证方法

```bash
SID=$(cat /tmp/dwr_session_id) && sumeru session remove $SID
# 期望: Removed | removed | deleted
```

## 父节点

- [spec 根目录](../README.md)
