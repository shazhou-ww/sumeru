# 在 Session 中执行命令

## Precondition

- Prototype `test-proto` 存在
- 新建一个 Session 用于执行测试

## Postcondition

- Session 中成功执行 `echo test` 命令
- 命令输出包含 `test`
- 测试结束后清理 Session

## 验证方法

```bash
SID=$(cat /tmp/exec_session_id) && sumeru session exec $SID -- echo test
# 期望: 输出包含 "test"
```

## 父节点

- [create-session](../README.md)
