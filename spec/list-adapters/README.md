# 列出所有已注册的 Adapters

## Precondition

- Server 正在运行
- Adapter 注册表包含内置 adapters

## Postcondition

- 返回所有已注册的 adapter 列表
- 包含 claude-code、sarsapa、hermes 等

## 验证方法

```bash
sumeru adapter list --format json
# 期望: 包含 "name": "claude-code"、"sarsapa"、"hermes"
```

## 父节点

- [spec 根目录](../README.md)
