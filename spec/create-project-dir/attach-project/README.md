# 创建带项目目录的 Session

## Precondition

- 项目目录 `~/.sumeru/projects/test-project` 已创建（由父节点创建）
- 目录中包含 `README.md` 文件
- Prototype `test-proto` 存在

## Postcondition

- Session 被创建并挂载项目目录
- SID 存储在 `/tmp/project_session_id`
- Adapter 可访问项目文件

## 验证方法

```bash
SID=$(cat /tmp/project_session_id) && sumeru session get $SID --format json
# 期望: SID=ses_[A-Z0-9]+
```

## 子节点

- [read-project-file](read-project-file/README.md) — 读取项目目录中的文件

## 父节点

- [create-project-dir](../README.md)
