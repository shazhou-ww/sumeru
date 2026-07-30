# POST 非法 JSON（400）

## Precondition

- Server 正在运行

## Postcondition

- 非法 JSON 输入被拒绝
- 返回错误信息（404 not found 或 invalid）

## 验证方法

```bash
sumeru session send ses_FAKEFAKEFAKE '{"invalid": json}' 2>&1
# 期望: not found | 404 | error | invalid
```

## 父节点

- [spec 根目录](../README.md)
