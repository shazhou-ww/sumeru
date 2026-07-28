# Sumeru 测试规范

本目录包含 Sumeru CLI 的 treespec 测试用例，每个子目录代表一个独立的测试场景，对应的 `README.md` 是该场景的行为规范文档。

## 目录结构

```
spec/
├── add-persona/           # Persona CRUD 测试
│   └── README.md          # Persona 行为规范
├── add-provider/          # Provider CRUD 测试
│   ├── add-model/         # Model CRUD 测试
│   │   ├── add-prototype-with-model/  # Prototype CRUD 测试
│   │   │   ├── create-session/        # Session 生命周期测试
│   │   │   └── README.md              # Prototype 行为规范
│   │   └── README.md                  # Model 行为规范
│   └── README.md                      # Provider 行为规范
├── get-adapter/           # Adapter 查询测试
│   └── README.md          # Adapter 行为规范
├── restart-server/        # Server 生命周期测试
│   └── README.md          # Server 行为规范
└── ...                    # 其他场景
```

## 测试框架

使用 [treespec](https://github.com/shazhou/treespec) 进行树形状态测试，支持：
- Docker 容器隔离
- 状态依赖链（parent → children）
- 文件系统状态共享（通过 `/tmp/` 目录）
- 超时控制（`timeout` 配置）

## 运行测试

```bash
# 运行所有测试
treespec run

# 运行单个场景
treespec run add-provider

# 查看详细输出
treespec run -v add-provider/add-model
```

## 行为规范文档

每个子目录的 `README.md` 包含：
1. **API 规范** - 端点、请求/响应格式、状态码
2. **CLI 命令** - 参数、使用示例、副作用
3. **状态转换** - 前置条件 → 操作 → 后置条件
4. **错误处理** - 常见错误场景和响应

这些文档从旧的 `specs/` 目录搬迁而来，现在与测试用例共存，便于维护和查阅。
