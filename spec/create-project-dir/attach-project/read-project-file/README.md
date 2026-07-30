# 读取项目目录中的文件

## Precondition

- Session 已创建并挂载项目目录（SID 存储在 `/tmp/project_session_id`）
- 项目目录包含 `README.md`（内容为 `Hello from project`）
- Adapter 已处理 `Read the project file` 任务

## Postcondition

- Turns 输出显示 Adapter 成功读取并响应了项目文件内容

## 验证方法

```bash
SID=$(cat /tmp/project_session_id) && sleep 5 && sumeru session turns $SID
# 期望: 包含 "Read the project file" / turn 关键词
```

## 父节点

- [attach-project](../README.md)
