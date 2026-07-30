# 列出所有 Sessions

## Precondition

- 至少一个 Session 已存在（由父节点 `create-session` 创建）
- Prototype `test-proto` 存在

## Postcondition

- 返回所有 Session 列表，包含已创建的 Session

## 验证方法

```bash
sumeru session list --format json
# 期望: 包含 ses_[A-Z0-9]+ 格式的 Session ID
```

## 父节点

- [create-session](../README.md)
