---
id: http-envelope-pattern
title: "HTTP Envelope Pattern"
sources:
  - packages/server/src/envelope.ts
  - packages/server/src/types.ts
  - packages/server/src/handler.ts
tags: [architecture, http, api-design]
created: 2026-06-17
updated: 2026-06-17
---

# HTTP Envelope Pattern

Sumeru 的所有 HTTP 响应都使用统一的 **ocas envelope 格式** `{ type, value }`，提供类型标识和结构化错误处理。

## Envelope Type

```typescript
export type Envelope<T> = {
  type: string;     // 类型标识符，如 "@sumeru/instance"
  value: T;         // 实际载荷
};
```

- **`type`** — 字符串标识符，标识响应的语义类型
- **`value`** — 实际数据载荷，类型由 `type` 决定

## Design Principles

1. **统一结构** — 所有成功响应（2xx）和错误响应（4xx/5xx）都使用相同的 `{ type, value }` 外壳
2. **类型自描述** — `type` 字段让客户端无需检查 HTTP 状态码即可识别响应类型
3. **JSON 序列化** — 所有 envelope 都是纯 JSON，无需特殊解析
4. **Ocas 一致性** — 与 ocas 内容寻址存储的节点格式一致（`{ type, payload }`）

## Envelope Types

### Success Envelopes (2xx)

| Type | HTTP Method & Path | Status | Value Type |
|------|-------------------|--------|------------|
| `@sumeru/instance` | `GET /` | 200 | `Instance` |
| `@sumeru/gateway-list` | `GET /gateways` | 200 | `Gateway[]` |
| `@sumeru/gateway` | `GET /gateways/:name` | 200 | `Gateway` |
| `@sumeru/session` | `POST /gateways/:name/sessions` | 201 | `SessionWire` |
| `@sumeru/session` | `GET /gateways/:name/sessions/:id` | 200 | `SessionWire` |
| `@sumeru/session-list` | `GET /gateways/:name/sessions` | 200 | `SessionListEntry[]` |
| `@sumeru/message-history` | `GET .../sessions/:id/messages` | 200 | `MessageHistoryValue` |
| `@sumeru/search-result` | `GET /sessions?q=...` | 200 | `SearchResultValue` |
| `@sumeru/turn` | ocas node (not HTTP) | N/A | `Turn` |
| `@sumeru/session-meta` | ocas node (not HTTP) | N/A | session metadata |

### Error Envelope (4xx / 5xx)

所有非 2xx 响应都使用 `@sumeru/error` envelope：

```typescript
export type ErrorValue = {
  error: string;      // 错误代码（kebab-case）
  message: string;    // 人类可读的错误消息
};
```

示例：

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "gateway_not_found",
    "message": "Gateway hermes not found"
  }
}
```

常见错误代码：

| Error Code | HTTP Status | 说明 |
|-----------|-------------|------|
| `route_not_found` | 404 | 路由不存在 |
| `gateway_not_found` | 404 | Gateway 不存在 |
| `session_not_found` | 404 | Session 不存在 |
| `adapter_unavailable` | 503 | Adapter 未注册或不可用 |
| `adapter_error` | 502 | Adapter 调用失败 |
| `adapter_timeout` | 504 | Adapter 调用超时 |
| `method_not_allowed` | 405 | HTTP 方法不允许 |
| `invalid_request` | 400 | 请求格式错误 |
| `invalid_json` | 400 | JSON 解析失败 |
| `invalid_cwd` | 400 | CWD 路径非法 |
| `ocas_write_failed` | 500 | Ocas 写入失败 |
| `ocas_not_found` | 404 | Ocas 节点不存在 |
| `invalid_hash` | 400 | 哈希格式错误 |

## Envelope Factories

`envelope.ts` 提供工厂函数，每个函数对应一个 envelope 类型：

```typescript
// 通用 envelope 构造器
export function envelope<T>(type: string, value: T): Envelope<T> {
  return { type, value };
}

// 特定类型的工厂函数
export function instanceEnvelope(instance: Instance): Envelope<Instance>;
export function gatewayListEnvelope(gateways: Gateway[]): Envelope<Gateway[]>;
export function gatewayEnvelope(gateway: Gateway): Envelope<Gateway>;
export function sessionEnvelope(session: SessionWire): Envelope<SessionWire>;
export function sessionListEnvelope(sessions: SessionListEntry[]): Envelope<SessionListEntry[]>;
export function errorEnvelope(error: string, message: string): Envelope<ErrorValue>;
export function searchResultEnvelope(value: SearchResultValue): Envelope<SearchResultValue>;
```

## Usage in Handler

Handler 中所有响应都通过 `writeJson()` 写入 envelope：

```typescript
// 成功响应
writeJson(res, 200, instanceEnvelope({
  name: config.name,
  version: config.version,
  gateways: Object.keys(config.gateways),
}));

// 错误响应
writeJson(res, 404, errorEnvelope(
  "gateway_not_found",
  `Gateway ${name} not found`
));
```

`writeJson()` helper:

```typescript
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
  res.end(payload);
}
```

## Example Responses

### GET /

```json
{
  "type": "@sumeru/instance",
  "value": {
    "name": "sumeru@local",
    "version": "0.1.0",
    "gateways": ["hermes", "claude-code"]
  }
}
```

### GET /gateways

```json
{
  "type": "@sumeru/gateway-list",
  "value": [
    {
      "name": "hermes",
      "adapter": "hermes",
      "status": "ready",
      "activeSessions": 3,
      "capabilities": { "resume": true, "streaming": true }
    }
  ]
}
```

### POST /gateways/hermes/sessions (201)

```json
{
  "type": "@sumeru/session",
  "value": {
    "id": "ses_01JXYZ",
    "gateway": "hermes",
    "status": "idle",
    "createdAt": "2026-06-17T12:34:56.789Z",
    "config": { "cwd": "/workspace" }
  }
}
```

### 404 Error

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_not_found",
    "message": "Session ses_01JXYZ not found on gateway hermes"
  }
}
```

## Benefits

1. **类型安全** — TypeScript 客户端可根据 `type` 字段推断 `value` 类型
2. **一致性** — 所有响应（包括错误）都使用相同外壳，简化客户端处理
3. **可扩展** — 新增响应类型只需添加新的 `type` 字符串，无需修改结构
4. **自描述** — `type` 字段提供语义标识，无需依赖 HTTP 状态码或 URL 路径
5. **Ocas 对齐** — 与 ocas 存储的节点格式一致，便于在 HTTP 和存储层之间传递数据

## Special Case: 204 No Content

`DELETE /gateways/:name/sessions/:id` 返回 `204 No Content`（无 body），这是唯一不使用 envelope 的响应。

## Non-HTTP Envelopes

某些 envelope 类型仅用于 ocas 存储，不直接出现在 HTTP 响应中：

- `@sumeru/turn` — Turn 内容节点，通过 `GET /ocas/:hash` 或 `GET .../messages` 间接访问
- `@sumeru/session-meta` — Session 元数据节点，仅在 ocas 内部使用
- `@ocas/schema` — Schema 节点，通过 `/ocas/:hash` 访问

这些节点使用相同的 `{ type, value }` 结构，保持整个系统的一致性。
