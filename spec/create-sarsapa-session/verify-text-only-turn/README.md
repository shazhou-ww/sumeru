# 验证纯文本轮次处理

## Precondition

- Sarsapa Session 已创建（SID 存储在 `/tmp/sarsapa_session_id`）
- Adapter 已处理至少一轮对话

## Postcondition

- Turns 包含纯文本类型的轮次（无 tool call）
- role 字段区分 user/assistant

## 验证方法

```bash
SID=$(cat /tmp/sarsapa_session_id) && sleep 5 && sumeru session turns $SID --format json
# 期望: 包含 ses_ / turn / role / content
```

## 父节点

- [create-sarsapa-session](../README.md)
