# 分页查询 Sessions

## Precondition

- 系统中存在多个 Session（由父节点创建 3 个）

## Postcondition

- 分页查询返回指定数量的 Session
- 支持 `--limit` 参数

## 验证方法

```bash
sumeru session list --limit 2 --format json
# 期望: 返回最多 2 个 ses_ 条目
```

## 父节点

- [create-multiple-sessions](../README.md)
