# 发送消息并等待回复

## Precondition

- Session 已存在（SID 存储在 `/tmp/send_session_id`，由 send-message 步骤创建）
- Prototype `test-proto` 存在，Adapter 已就绪

## Postcondition

- 消息 `What is 2+2?` 被成功发送并被 Adapter 处理
- Session 产生新的 turn 记录

## 验证方法

```bash
SID=$(cat /tmp/send_session_id) && sumeru session send $SID 'What is 2+2?'
# 期望: Message sent | accepted message
```

## 子节点

- [send-append](send-append/README.md) — 发送追加消息 + turns 查询测试

## 父节点

- [create-session](../README.md)
