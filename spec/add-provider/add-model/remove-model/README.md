# 删除 Model

## Precondition

- Provider `test-provider` 已存在
- Model `test-model` 已存在（由父节点 `add-model` 创建）
- Model 未被任何 Prototype 引用

## Postcondition

- Model `test-model` 被删除
- `sumeru model get test-model` 返回 404

## 验证方法

```bash
sumeru model get test-model 2>&1
# 期望: not found
```

## 父节点

- [add-model](../README.md)
