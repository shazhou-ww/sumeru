# 更新 Prototype 的 Model

## Precondition

- Prototype `test-proto` 已存在（由父节点创建）
- 新增 Provider `update-provider` + Model `new-model` 作为更新目标

## Postcondition

- Prototype `test-proto` 的 model 字段更新为 `new-model`
- 其他字段保持不变

## 验证方法

```bash
sumeru prototype get test-proto --format json
# 期望: model 包含 "new-model"
```

## 父节点

- [add-prototype-with-model](../README.md)
