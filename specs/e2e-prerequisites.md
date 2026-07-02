---
id: e2e-prerequisites
tags: [e2e, setup]
---

# E2E 测试前置条件

所有 e2e 类型的 TC 共享以下环境准备步骤。

## 一次性初始化

```bash
# 1. 构建代码
pnpm run build

# 2. 构建 Docker 镜像（首次或代码变更后）
sumeru image build sarsapa --agent sarsapa

# 3. 初始化测试环境（用真实 API Key）
sumeru setup \
  --provider siliconflow \
  --api-key "$SILICONFLOW_API_KEY" \
  --model deepseek-ai/DeepSeek-V3 \
  --root-dir /tmp/sumeru-e2e
```

执行后 `/tmp/sumeru-e2e` 包含：
- `host.yaml`、`.env`
- `data/sumeru.db`（含 Provider `siliconflow`、Model `deepseek-v3`、Persona `default`）
- `data/prototypes/sarsapa.yaml`
- `prototypes/sarsapa/compose.yaml`

## 启动 Host

```bash
SUMERU_PORT=7901 node packages/host/dist/main.js /tmp/sumeru-e2e
```

验证：
```bash
curl -s http://127.0.0.1:7901/ | jq '.value.status'
# → { "running": 0, "queued": 0, "idle": 0 }
```

## 添加更多 Model（可选）

已初始化的环境可以重复 setup 添加新 provider/model：

```bash
sumeru setup \
  --provider deepseek \
  --api-key "$DEEPSEEK_API_KEY" \
  --model deepseek-chat \
  --root-dir /tmp/sumeru-e2e
```

或通过 API 添加（host 运行中）：

```bash
curl -s -X POST http://127.0.0.1:7901/models/qwen3-8b \
  -H 'Content-Type: application/json' \
  -d '{"provider":"siliconflow","model":"Qwen/Qwen3-8B"}'
```

## 清理

```bash
rm -rf /tmp/sumeru-e2e
```

## 注意事项

- 使用 **端口 7901**（避免与生产 host 7900 冲突）
- Provider/Model CRUD TC 不需要预先 seed 数据 — 它们测试的就是 CRUD 本身
- Session/Prototype TC 需要 Provider + Model + Persona 已存在 — 直接依赖 setup 产出
