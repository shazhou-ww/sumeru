# 删除被 Model 引用的 Provider（409）

## Precondition

- Provider `test-provider` 已存在
- Model `test-model` 已存在且引用 `test-provider`

## Postcondition

- 删除操作被拒绝，返回 409 `provider_in_use`
- Provider `test-provider` 仍然存在

## 验证方法

```bash
sumeru provider remove test-provider 2>&1
# 期望: provider_in_use | 409 | in use
```

## 父节点

- [add-model](../README.md)
