# 删除 Provider

## Precondition

- Provider `test-provider` 已存在（由父节点 `add-provider` 创建）
- Provider 下的 Model 已被删除（无引用）

## Postcondition

- Provider `test-provider` 被删除
- `sumeru provider get test-provider` 返回 404

## 验证方法

```bash
sumeru provider get test-provider 2>&1
# 期望: not found
```

## 父节点

- [add-provider](../README.md)
