# 验证 Token Usage 统计

## Precondition

- Sarsapa Session 已创建（SID 存储在 `/tmp/sarsapa_session_id`）
- Adapter 已处理对话并记录 token 用量

## Postcondition

- Turns 输出包含 token/usage 相关字段

## 验证方法

```bash
SID=$(cat /tmp/sarsapa_session_id) && sleep 5 && sumeru session turns $SID --format json
# 期望: 包含 token / usage / turn 关键词
```

## 父节点

- [create-sarsapa-session](../README.md)
