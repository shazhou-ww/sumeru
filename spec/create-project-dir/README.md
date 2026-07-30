# 创建项目目录

## Precondition

- Server 正在运行
- `~/.sumeru/projects/` 目录可写

## Postcondition

- 项目目录 `~/.sumeru/projects/test-project` 被创建
- 目录中包含 `README.md` 文件（内容为 `Hello from project`）
- 该目录可被后续 session 通过 `--project` 挂载

## 验证方法

```bash
ls ~/.sumeru/projects/test-project/README.md
# 期望: 文件存在
cat ~/.sumeru/projects/test-project/README.md
# 期望: Hello from project
```

## 子节点

- [attach-project](attach-project/README.md) — 创建带项目目录的 session
- [attach-project/read-project-file](attach-project/read-project-file/README.md) — 读取项目目录中的文件

## 父节点

- [spec 根目录](../README.md)
