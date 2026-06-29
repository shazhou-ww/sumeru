# Docker Image Validation — Eval Task

> 验证 Sumeru Docker image 能否承载真实开发任务。每次构建新 image 后对着跑一遍。

## 设计原则

- **一个任务验证一个 image** — 不混跑，失败可定位
- **从零开始** — 不给 scaffold，agent 自己 init 项目、装依赖、写代码
- **产出可验证** — 给固定输入，检查输出是否正确
- **幂等** — 每次跑前清空工作区，结果不依赖外部状态

---

## Eval Task: CLI Calculator

### 目标

从零创建一个 Node.js CLI 计算器。输入数学公式，输出计算结果。

### Prompt

```
Create a CLI calculator in TypeScript at /workspace.

Requirements:
1. Initialize a Node.js project with TypeScript
2. The calculator should be runnable as: npx tsx src/calc.ts "<expression>"
3. Support: +, -, *, /, parentheses, negative numbers, decimals
4. Respect operator precedence: 2 + 3 * 4 = 14, not 20
5. Handle errors gracefully (division by zero, invalid input)
6. Write unit tests covering normal cases and edge cases
7. All tests must pass

When done, show me the test results and a few example runs.
```

### 为什么这个任务够好

| 维度 | 覆盖 |
|------|------|
| 项目初始化 | `npm init` + `package.json` + `tsconfig.json` |
| 依赖安装 | `npm install typescript tsx vitest` 等 — 需要网络 + 写权限 |
| 编码能力 | 表达式解析、运算符优先级、错误处理 — 不是trivial |
| 测试编写 | 必须覆盖多种情况 |
| 命令执行 | `npx tsx` / `npm test` — tool use 链路 |
| 多步迭代 | 装依赖 → 写代码 → 跑测试 → 可能修 bug → 再跑 |

---

## 执行方式

### 准备工作区

```bash
rm -rf /tmp/sumeru-eval && mkdir -p /tmp/sumeru-eval
```

### 通过 Sumeru Host（完整链路）

```bash
# 1. 启动 Host
cd ~/repos/sumeru && node packages/host/dist/main.js &

# 2. 创建 instance，挂载空工作区
INST=$(curl -s -X POST http://127.0.0.1:7902/instances \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"<adapter-name>","projects":["/tmp/sumeru-eval"]}' \
  | jq -r '.value.id')

# 3. 投递任务
curl -s -X POST "http://127.0.0.1:7902/instances/$INST/inbox" \
  -H 'Content-Type: application/json' \
  -d "{\"messageId\":\"eval-1\",\"content\":\"<prompt>\",\"project\":\"/tmp/sumeru-eval\"}"

# 4. 订阅产出
curl -sN "http://127.0.0.1:7902/instances/$INST/outbox"
```

### 直接 docker exec（快速验证单个 image）

```bash
docker run -d --name eval-test \
  --user "$(id -u):$(id -g)" \
  --network host \
  -v /tmp/sumeru-eval:/workspace \
  sumeru/claude-code:dev

docker exec eval-test node /opt/sumeru/adapter-claude-code/dist/main.js <<'JSONL'
{"type":"init","value":{"instructions":"","skills":[],"model":{"provider":"anthropic","name":"claude-sonnet-4-20250514","apiKey":"${ANTHROPIC_API_KEY}","contextWindow":200000}}}
{"type":"message","value":{"messageId":"eval-1","content":"<prompt>","project":"/workspace","resumeNativeId":null}}
JSONL
```

Adapter 替换表：

| Adapter | Entry point | 环境变量 | Model 示例 |
|---------|------------|---------|-----------|
| claude-code | `/opt/sumeru/adapter-claude-code/dist/main.js` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| codex | `/opt/sumeru/adapter-codex/dist/main.js` | `OPENAI_API_KEY` | `o3-mini` |
| hermes | `/opt/sumeru/adapter-hermes/dist/main.js` | 取决于 provider | `claude-sonnet-4-20250514` |

---

## 验证标准

任务完成后在宿主机检查 `/tmp/sumeru-eval/`。

### 自动检查（必须全过）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | `node_modules/` 存在 | 依赖已安装 |
| 2 | `tsconfig.json` 存在 | TypeScript 已配置 |
| 3 | 主入口文件存在 | `src/calc.ts` 或类似 |
| 4 | 测试文件存在 | `tests/` 或 `*.test.ts` |
| 5 | 测试通过 | `npm test` exit code 0 |

### 计算验证（给公式、看结果）

| 输入 | 期望输出 | 验证点 |
|------|---------|--------|
| `"2 + 3"` | `5` | 基本加法 |
| `"2 + 3 * 4"` | `14` | 运算符优先级 |
| `"(2 + 3) * 4"` | `20` | 括号 |
| `"10 / 3"` | `3.333...` | 除法小数 |
| `"-5 + 3"` | `-2` | 负数 |
| `"1 / 0"` | 错误信息 | 除零处理 |
| `"abc"` | 错误信息 | 非法输入 |

### 验证脚本

```bash
#!/bin/bash
# scripts/verify-eval.sh
set -e
DIR="/tmp/sumeru-eval"
FAIL=0

check() {
  echo -n "  [$1] "
  if eval "$2"; then echo "✅"; else echo "❌"; FAIL=1; fi
}

echo "=== Structure ==="
check "node_modules"    "test -d $DIR/node_modules"
check "tsconfig.json"   "test -f $DIR/tsconfig.json"
check "source file"     "find $DIR/src -name '*.ts' | grep -q ."
check "test file"       "find $DIR -name '*.test.ts' -o -name '*.spec.ts' | grep -q ."

echo "=== Tests ==="
check "tests pass"      "cd $DIR && npm test --silent 2>&1 | tail -1 | grep -qi pass"

echo "=== Calculation ==="
CALC="npx --yes tsx"
run_calc() { cd "$DIR" && $CALC src/calc.ts "$1" 2>&1 | tail -1; }

check "2+3=5"           "[[ \$(run_calc '2 + 3') == *5* ]]"
check "2+3*4=14"        "[[ \$(run_calc '2 + 3 * 4') == *14* ]]"
check "(2+3)*4=20"      "[[ \$(run_calc '(2 + 3) * 4') == *20* ]]"
check "1/0=error"       "run_calc '1 / 0' | grep -qi -e error -e zero -e invalid"

if [ $FAIL -eq 0 ]; then
  echo -e "\n🎉 ALL CHECKS PASSED"
else
  echo -e "\n💥 SOME CHECKS FAILED"
  exit 1
fi
```

---

## 执行记录

| 日期 | Image | Tag | 结果 | Turns | 耗时 | 备注 |
|------|-------|-----|------|-------|------|------|
| | claude-code | dev | ⬜ | | | |
| | codex | dev | ⬜ | | | |
| | hermes | dev | ⬜ | | | |
