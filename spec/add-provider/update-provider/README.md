# 更新 Provider

## Precondition

- Provider `test-provider` 已存在（由父节点 `add-provider` 创建）
- baseUrl = `https://api.example.com`

## Postcondition

- Provider `test-provider` 的 baseUrl 更新为 `https://api.updated.com`
- 其他字段保持不变

## 验证方法

```bash
sumeru provider get test-provider --format json
# 期望: "baseUrl": "https://api.updated.com"
```

## 父节点

- [add-provider](../README.md)
