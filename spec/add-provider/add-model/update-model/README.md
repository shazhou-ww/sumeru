# 更新 Model

## Precondition

- Provider `test-provider` 已存在
- Model `test-model` 已存在（由父节点 `add-model` 创建）

## Postcondition

- Model `test-model` 的 contextWindow 更新为 128000
- 其他字段保持不变

## 验证方法

```bash
sumeru model get test-model --format json
# 期望: contextWindow 包含 128000 或 128k
```

## 父节点

- [add-model](../README.md)
