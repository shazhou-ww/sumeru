# 删除 Prototype

## Precondition

- Prototype `test-proto` 已存在（由父节点创建）
- Prototype 未被任何 Session 引用

## Postcondition

- Prototype `test-proto` 被删除
- `sumeru prototype get test-proto` 返回 404

## 验证方法

```bash
sumeru prototype get test-proto 2>&1
# 期望: not found
```

## 父节点

- [add-prototype-with-model](../README.md)
