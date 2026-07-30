# 创建多个 Sessions

## Precondition

- Prototype `test-proto` 存在
- 之前已有一个 Session（由父节点创建）

## Postcondition

- 系统中存在 3 个 Session（1 来自父节点 + 2 新建）
- 所有 Session 状态正常

## 验证方法

```bash
sumeru session list
# 期望: 至少 3 个 ses_[A-Z0-9]+ 条目
```

## 子节点

- [paginate-list](paginate-list/README.md) — 分页查询 sessions

## 父节点

- [create-session](../README.md)
