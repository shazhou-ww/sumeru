# 触发复合错误路径

## Precondition

- Server 正在运行

## Postcondition

- 多个错误路径被依次触发：
  - get 不存在的 session → 404
  - stop 不存在的 session → 404
  - rm 不存在的 session → 404
  - session add 缺少参数 → usage/help
  - session turns 非法 --after 参数 → invalid/NaN

## 验证方法

```bash
sumeru session get ses_FAKEFAKEFAKE 2>&1       # not found | 404
sumeru session stop ses_FAKEFAKEFAKE 2>&1      # not found | 404
sumeru session rm ses_FAKEFAKEFAKE 2>&1        # not found | 404
sumeru session add 2>&1                         # usage | help | error
sumeru session turns ses_FAKEFAKEFAKE --after abc 2>&1  # Error | invalid
```

## 父节点

- [spec 根目录](../README.md)
