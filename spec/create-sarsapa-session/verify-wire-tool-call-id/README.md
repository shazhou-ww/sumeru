# 验证 Tool Call ID 传递

## Precondition

- Sarsapa Session 已创建（SID 存储在 `/tmp/sarsapa_session_id`）
- Adapter 处理过包含 tool call 的轮次

## Postcondition

- Turns 输出包含 tool_call / id 字段
- Wire 层的 tool call ID 被正确传递到 turns 查询结果

## 验证方法

```bash
SID=$(cat /tmp/sarsapa_session_id) && sleep 5 && sumeru session turns $SID --format json
# 期望: 包含 tool_call / id / turn 关键词
```

## 父节点

- [create-sarsapa-session](../README.md)
