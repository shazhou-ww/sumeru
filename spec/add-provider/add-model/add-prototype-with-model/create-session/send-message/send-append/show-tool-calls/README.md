# 显示工具调用

## Precondition

- Session 已有多轮对话
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 文本格式输出展示 user/assistant 的对话内容

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session turns $SID
# 期望: 输出包含 user / assistant / Say hello
```

## 父节点

- [send-append](../README.md)
