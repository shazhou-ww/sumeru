# 发送追加消息

## Precondition

- Session 已存在且已有一轮对话（由父节点 `send-message` 创建）
- SID 存储在 `/tmp/send_session_id`

## Postcondition

- 追加消息 `What is 3+3?` 被成功发送
- Turns 历史增加新一轮

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session send $SID 'What is 3+3?'
# 期望: Message sent | accepted message
```

## 子节点

- [list-turns](list-turns/README.md) — 列出所有 turns
- [paginate-turns](paginate-turns/README.md) — 分页查询 turns
- [watch-turns](watch-turns/README.md) — 实时监控 turns
- [filter-by-role](filter-by-role/README.md) — 按偏移量查询 turns
- [filter-by-time](filter-by-time/README.md) — 限制查询结果数量
- [filter-by-tool](filter-by-tool/README.md) — 按工具类型过滤 turns
- [inspect-turn-structure](inspect-turn-structure/README.md) — 检查 turn 结构
- [show-tool-calls](show-tool-calls/README.md) — 显示工具调用

## 父节点

- [send-message](../README.md)
