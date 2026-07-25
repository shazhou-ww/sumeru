---
command: sumeru model add <name>
related_cases:
  - model-crud.test.yaml
---

# sumeru model add

## 描述

注册新 model（关联到 provider）。

## 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | Model registry 名称（位置参数） |
| --provider | string | 是 | - | Provider 名称 |
| --model | string | 是 | - | API model 名称（发送给 API 的实际模型名） |
| --context-window | string | 否 | - | 上下文窗口大小（如 128k, 1m） |
| --format | string | 否 | text | 输出格式（text/json） |
| --compact | boolean | 否 | false | 紧凑输出 |
| --quiet | boolean | 否 | false | 静默模式 |

## 用例

### 用例 1：正常创建 model

**前置条件**：provider "openai" 存在

**命令**：
```bash
sumeru model add gpt-4 --provider openai --model gpt-4-turbo-preview --context-window 128k
```

**后置条件**：

**text**：
```
Created model gpt-4
```

**json**：
```json
{
  "name": "gpt-4"
}
```

**副作用**：
- model "gpt-4" 出现在 `sumeru model list` 中

### 用例 2：provider 不存在

**前置条件**：provider "nonexistent" 不存在

**命令**：
```bash
sumeru model add gpt-4 --provider nonexistent --model gpt-4
```

**后置条件**：

**退出码**：非 0

**输出**：包含 "provider_not_found" 的错误信息

### 用例 3：缺少 --provider 或 --model

**前置条件**：无

**命令**：
```bash
sumeru model add gpt-4 --provider openai
```

**后置条件**：

**退出码**：非 0

**输出**：包含 usage 提示信息

**副作用**：无
