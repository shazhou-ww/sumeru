# 列出 Adapter 的内置模型（无 API Key）

## Precondition

- Server 正在运行
- Adapter `cursor-agent` 已注册
- 环境未设置 `CURSOR_API_KEY`

## Postcondition

- 返回错误提示 credential 缺失
- 不崩溃，优雅降级

## 验证方法

```bash
sumeru adapter models cursor-agent 2>&1
# 期望: credential_missing | CURSOR_API_KEY | error
```

## 父节点

- [spec 根目录](../README.md)
