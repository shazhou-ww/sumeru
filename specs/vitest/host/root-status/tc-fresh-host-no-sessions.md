---
id: tc-fresh-host-no-sessions
spec: root-status
tags: [e2e, host, status, health-check, happy-path]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - No sessions currently active
---

# Fresh Host — No Sessions

验证 Host 在无 session 状态下 GET / 返回正确的状态信息。

## Setup

无额外 setup。确认 host 处于无 session 状态即可。

## Steps

1. 查询根路径：
   ```bash
   curl -s http://127.0.0.1:7901/
   ```

2. 验证响应结构：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.type'
   ```
   → 应返回 `"@sumeru/host"`

3. 验证 name 来自 host.yaml 配置：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.name'
   ```
   → 应返回配置的 host name（字符串，非空）

4. 验证 version 为非空字符串：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.version'
   ```
   → 应返回版本号字符串

5. 验证 status 字段各计数为 0：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回 `{"running": 0, "queued": 0, "idle": 0}`

6. 验证 uptime > 0：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.uptime'
   ```
   → 应返回大于 0 的数值（毫秒）

## Expected

- [ ] HTTP 状态码为 200
- [ ] `.type` = `"@sumeru/host"`
- [ ] `.value.name` 为非空字符串
- [ ] `.value.version` 为非空字符串
- [ ] `.value.status.running` = 0
- [ ] `.value.status.queued` = 0
- [ ] `.value.status.idle` = 0
- [ ] `.value.uptime` > 0

## Failure Signals

- 返回非 200 → 路由未注册或 host 未启动
- type 不是 `@sumeru/host` → 根路由响应格式错误
- status 字段缺失 → hostRoot() 未正确实现
- uptime 为 0 或负数 → startedAt 时间戳记录问题
