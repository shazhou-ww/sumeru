# 挂载非法路径（400）

## Precondition

- Server 正在运行
- Prototype `test-proto` 已存在

## Postcondition

- `--project /etc/passwd` 被拒绝，返回 400 错误
- Session 不被创建

## 验证方法

```bash
sumeru session add test-proto --project /etc/passwd --task 'test' 2>&1
# 期望: project_path_out_of_bounds | 400 | invalid | error
```

## 父节点

- [spec 根目录](../README.md)
