# 同时更新 Prototype 多个字段

## Precondition

- Prototype `test-proto` 已存在
- 新增 Provider `update-provider` + Model `updated-model` 作为更新目标

## Postcondition

- Prototype `test-proto` 的 model 和 adapter 同时更新
- model → `updated-model`，adapter → `hermes`

## 验证方法

```bash
sumeru prototype get test-proto --format json
# 期望: 包含 "updated-model" 和 "hermes"
```

## 父节点

- [add-prototype-with-model](../README.md)
