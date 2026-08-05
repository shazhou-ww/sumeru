# Adapter 安装与自包含镜像设计

## 背景

当前架构的问题：
1. Adapter 镜像构建流程繁琐：需要手动运行 `pnpm run build:images`，生成 `images/*.tar.gz`
2. 镜像依赖共享 base：所有 adapter Dockerfile 都 `FROM sumeru/base:dev`
3. Adapter 注册硬编码：`adapter-registry.ts` 静态 import 所有 adapter manifest
4. 用户心智模型混乱：需要理解 provider → prototype → image → session 的多层概念
5. 开发环境复杂：需要预构建镜像并通过 bind mount 传递到测试容器

## 目标

将 adapter 改为独立的 npm 包，支持：
- 从 npm 安装：`sumeru adapter add @sumeru/adapter-sarsapa`
- 从本地路径安装：`sumeru adapter add ./packages/sarsapa`
- 安装时自动构建自包含 Docker 镜像
- 安装时自动注册默认 prototype
- 简化用户心智模型：adapter → prototype → session

## 核心设计

### 1. Adapter 包结构

每个 adapter 是一个 npm 包，包含 `sumeru-adapter.yaml` 清单文件：

```yaml
name: sarsapa
version: 0.4.1
dockerfile: ./Dockerfile
cli: ./dist/main.js
default_instructions: "You are a helpful assistant."
default_model: null
```

包结构示例：
```
packages/sarsapa/
├── package.json
├── sumeru-adapter.yaml
├── Dockerfile
├── src/
├── dist/
│   └── main.js
└── ...
```

### 2. Adapter ID

Adapter ID 格式：`<name>:<hash>`
- `name`: 来自 `sumeru-adapter.yaml`
- `hash`: 对 package 内容计算（包括 `sumeru-adapter.yaml`、`Dockerfile`、`dist/` 等）

示例：`sarsapa:abc123`

**用途：**
- 唯一标识 adapter 版本
- Docker image tag：`sumeru/<name>:<hash>`
- 默认 prototype name：`sumeru/base/<name>:<hash>`

### 3. Adapter 引用解析

用户在命令中引用 adapter 时：
- 完整 ID：`sarsapa:abc123`（精确匹配）
- 短名：`sarsapa`（前缀匹配，多个匹配时报错提示）

示例：
```bash
# 只有一个 sarsapa 版本
sumeru prototype add my-proto --adapter sarsapa --model gpt-4

# 多个 sarsapa 版本时
sumeru prototype add my-proto --adapter sarsapa --model gpt-4
# Error: Multiple adapters match 'sarsapa':
#   - sarsapa:abc123 (v0.4.1)
#   - sarsapa:def456 (v0.5.0)
# Please specify the full adapter ID.
```

### 4. 安装流程

`sumeru adapter add <path|npm-spec>`：

```typescript
async function addAdapter(source: string): Promise<void> {
  // 1. 解析 source
  const resolved = resolveAdapterSource(source); // npm spec or local path
  
  // 2. 读取 sumeru-adapter.yaml
  const manifest = readAdapterManifest(resolved.path);
  
  // 3. 计算 package hash
  const hash = await computePackageHash(resolved.path);
  const adapterId = `${manifest.name}:${hash}`;
  
  // 4. 检查是否已安装
  if (await adapterExists(adapterId)) {
    console.log(`Adapter ${adapterId} already installed.`);
    return;
  }
  
  // 5. 确保 dockerd 运行
  await ensureDockerd();
  
  // 6. 构建自包含 Docker 镜像
  const imageTag = `sumeru/${manifest.name}:${hash}`;
  await buildAdapterImage(resolved.path, manifest.dockerfile, imageTag);
  
  // 7. 注册默认 prototype
  const defaultProtoName = `sumeru/base/${adapterId}`;
  await registerDefaultPrototype({
    name: defaultProtoName,
    adapter: adapterId,
    image: imageTag,
    instructions: manifest.default_instructions,
    model: manifest.default_model,
  });
  
  // 8. 持久化 adapter 元数据
  await persistAdapter({
    id: adapterId,
    name: manifest.name,
    version: manifest.version,
    source: resolved.source, // npm spec or path
    imageTag,
    installedAt: new Date().toISOString(),
  });
}
```

### 5. Dockerfile 设计（Common Base + 可选覆盖）

所有 adapter 默认使用 **common base image**，adapter 的 Dockerfile 只需 `FROM` 这个 base 并 COPY 自己的代码。

#### Common Base Image

由 host 维护，提供 adapter 运行时的通用环境（Node.js、Python、uv、常用工具等）：

```dockerfile
# packages/host/docker/base.Dockerfile
FROM node:24-slim
# ... 安装 git, curl, ripgrep, uv, python3, build-essential 等
# 这个 base 不包含任何 adapter 代码
```

Base image tag: `sumeru/adapter-base:dev`

#### Adapter Dockerfile（默认）

```dockerfile
# packages/sarsapa/Dockerfile
FROM sumeru/adapter-base:dev
COPY --chown=node:node dist/ /home/node/adapter/dist/
COPY --chown=node:node package.json /home/node/adapter/
RUN cd /home/node/adapter && ln -s dist/main.js /home/node/.local/bin/sumeru-adapter
CMD ["sleep", "infinity"]
```

#### 可选覆盖

`sumeru-adapter.yaml` 可以指定自定义 base image：

```yaml
name: sarsapa
version: 0.4.1
dockerfile: ./Dockerfile
cli: ./dist/main.js
baseImage: null          # null = 使用默认 common base
# baseImage: "python:3.12"  # 可选：自定义 base（用于需要特殊运行时的 adapter）
```

#### 构建流程

`adapter add` 时的构建顺序：
1. 检查 `sumeru/adapter-base:dev` 是否存在 → 不存在则从 host 内置 Dockerfile 构建
2. 读取 adapter 的 `sumeru-adapter.yaml`
3. 如果 `baseImage` 指定了自定义 base → 确保该 image 存在（pull 或本地已有）
4. 构建 adapter image（FROM base → COPY adapter 代码）

**关键点：**
- 默认用 common base，保持 adapter Dockerfile 简洁（只需 COPY 自己的代码）
- 可覆盖 baseImage，支持需要特殊运行时的 adapter（如 Python adapter）
- Common base 由 host 管理，不是某个 adapter 包的一部分
- 不再使用旧的 `sumeru/base:dev`（那个包含 adapter 代码，新设计只包含运行环境）

### 6. Prototype 创建

`sumeru prototype add` 从已有 prototype fork：

```typescript
async function addPrototype(input: AddPrototypeInput): Promise<void> {
  // 1. 解析 adapter 引用
  const adapterId = await resolveAdapterRef(input.adapter);
  
  // 2. 查找基础 prototype
  const baseProtoName = input.from ?? `sumeru/base/${adapterId}`;
  const baseProto = await getPrototype(baseProtoName);
  if (!baseProto) {
    throw new Error(`Base prototype '${baseProtoName}' not found.`);
  }
  
  // 3. Fork 并覆盖字段
  const newProto: Prototype = {
    name: input.name,
    adapter: adapterId,
    image: baseProto.image,
    instructions: input.instructions ?? baseProto.instructions,
    model: input.model ?? baseProto.model,
  };
  
  // 4. 持久化
  await writePrototypeFile(newProto);
}
```

**示例：**
```bash
# 从默认 prototype fork
sumeru prototype add my-proto --adapter sarsapa --model gpt-4

# 从其他用户 prototype fork
sumeru prototype add my-proto --from other-proto --model gpt-4
```

### 7. 用户工作流

完整流程：

```bash
# 1. 安装 adapter
sumeru adapter add @sumeru/adapter-sarsapa
# → 构建镜像 sumeru/sarsapa:abc123
# → 注册 prototype sumeru/base/sarsapa:abc123

# 2. 创建 prototype（可选）
sumeru prototype add my-proto --adapter sarsapa --model gpt-4

# 3. 创建 session
sumeru session add my-proto --task 'Hello'
# 或直接从默认 prototype 创建
sumeru session add sumeru/base/sarsapa:abc123 --task 'Hello' --model gpt-4

# 4. 聊天（可 override model）
sumeru session chat <session-id> --model claude-3-5-sonnet
```

## 数据模型变更

### 新增：Adapter 元数据

```typescript
type AdapterMetadata = {
  id: string; // name:hash
  name: string;
  version: string;
  source: string; // npm spec or local path
  imageTag: string;
  installedAt: string;
};

// 存储：~/.sumeru/adapters/<id>.json
```

### 变更：Prototype

```typescript
type Prototype = {
  name: string;
  adapter: string; // 改为 adapter ID (name:hash)
  image: string;
  instructions: string;
  model: string | null;
  // ... 其他字段不变
};
```

### 新增：默认 Prototype 命名规范

- 默认 prototype name：`sumeru/base/<adapter-id>`
- 示例：`sumeru/base/sarsapa:abc123`
- 用户可以看到：`sumeru prototype list` 会显示
- 用户可以直接使用：`sumeru session add sumeru/base/sarsapa:abc123`

## 实现细节

### 1. Package Hash 计算

```typescript
async function computePackageHash(packagePath: string): Promise<string> {
  const files = [
    'sumeru-adapter.yaml',
    'Dockerfile',
    'package.json',
    // 递归收集 dist/ 下所有文件
    ...await collectFiles(path.join(packagePath, 'dist')),
  ];
  
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const content = await readFile(file);
    hash.update(content);
  }
  
  return hash.digest('hex').slice(0, 6); // 短 hash
}
```

### 2. Adapter 解析

```typescript
async function resolveAdapterRef(ref: string): Promise<string> {
  const adapters = await listAdapters();
  
  // 精确匹配
  const exact = adapters.find(a => a.id === ref);
  if (exact) return exact.id;
  
  // 前缀匹配
  const matches = adapters.filter(a => a.id.startsWith(ref + ':') || a.name === ref);
  
  if (matches.length === 0) {
    throw new Error(`No adapter matches '${ref}'.`);
  }
  if (matches.length > 1) {
    const list = matches.map(a => `  - ${a.id} (${a.version})`).join('\n');
    throw new Error(`Multiple adapters match '${ref}':\n${list}\nPlease specify the full adapter ID.`);
  }
  
  return matches[0].id;
}
```

### 3. Docker 镜像构建

```typescript
async function buildAdapterImage(
  packagePath: string,
  dockerfile: string,
  imageTag: string
): Promise<void> {
  const dockerfilePath = path.join(packagePath, dockerfile);
  
  // 使用 dockerode 构建
  const stream = await docker.buildImage(
    {
      context: packagePath,
      src: [dockerfile],
    },
    {
      t: imageTag,
      dockerfile: dockerfile,
    }
  );
  
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err, output) => err ? reject(err) : resolve(output),
      (event) => console.log(event.stream || '')
    );
  });
}
```

## 迁移计划

### Phase 1: 基础设施

1. 创建 `packages/host/src/adapter-manager.ts`
   - `addAdapter()`: 安装 adapter
   - `removeAdapter()`: 卸载 adapter
   - `listAdapters()`: 列出已安装 adapter
   - `resolveAdapterRef()`: 解析 adapter 引用

2. 创建 `packages/host/src/image-builder.ts`
   - `buildAdapterImage()`: 构建自包含镜像
   - `computePackageHash()`: 计算 package hash
   - `readAdapterManifest()`: 读取 `sumeru-adapter.yaml`

3. 扩展 SQLite schema
   - 新增 `adapters` 表
   - 修改 `prototypes` 表，`adapter` 字段改为 ID

### Phase 2: CLI 命令

1. 新增 `sumeru adapter add <source>`
2. 新增 `sumeru adapter remove <id>`
3. 新增 `sumeru adapter list`
4. 修改 `sumeru prototype add`：支持 `--from` 参数

### Phase 3: Adapter 包迁移

1. 为每个 adapter 添加 `sumeru-adapter.yaml`
2. 为每个 adapter 创建自包含 `Dockerfile`
3. 移除 `docker/base.Dockerfile`
4. 移除 `scripts/build-images.mjs`（或保留为 CI 辅助工具）
5. 更新 `adapter-registry.ts`：改为从 SQLite 读取

### Phase 4: 文档与测试

1. 更新用户文档
2. 更新 treespec 测试：移除 `docker load` 步骤
3. 添加 adapter 安装流程的 e2e 测试

## 开放问题（已解决）

1. **Hash 计算范围**：所有 npm 包包含的文件（`package.json` `files` 字段指定的文件，或默认排除 `node_modules`、`.git` 等）
2. **版本冲突**：如果计算出的 hash 与已安装的 adapter 一致，说明 adapter 完全相同，直接复用，跳过重复安装
3. **卸载行为**：`adapter remove` 删除 Docker 镜像 + 元数据。如果有 prototype 引用该 adapter，应阻止删除
4. **离线安装**：暂不支持 tarball，仅支持本地路径和 npm registry

## 影响范围

### 删除的代码/功能

- `docker/base.Dockerfile`
- `docker/*.Dockerfile`（迁移到 adapter 包内）
- `scripts/build-images.mjs`（或降级为 CI 工具）
- `images/*.tar.gz` 生成逻辑
- `adapter-registry.ts` 中的静态 import

### 修改的代码

- `packages/host/src/transport.ts`：移除 `ensureDockerd()` 的手动调用（改为 `adapter add` 时调用）
- `packages/host/src/session-manager.ts`：移除 `image_not_found` 错误处理
- `packages/host/src/data-store.ts`：prototype 存储支持 adapter ID
- `packages/core/src/types.ts`：`Prototype.adapter` 改为 ID 格式

### 新增的代码

- `packages/host/src/adapter-manager.ts`：adapter 生命周期管理
- `packages/host/src/image-builder.ts`：Docker 镜像构建
- `packages/host/src/package-hasher.ts`：package hash 计算
- CLI 命令：`adapter add/remove/list`
- SQLite 表：`adapters`

## 时间估算

- Phase 1: 2-3 天
- Phase 2: 1-2 天
- Phase 3: 3-4 天（5 个 adapter 迁移）
- Phase 4: 1-2 天

**总计：7-11 天**

## 验收标准

1. ✅ `sumeru adapter add @sumeru/adapter-sarsapa` 成功安装
2. ✅ 安装后自动构建 Docker 镜像
3. ✅ 安装后自动注册默认 prototype
4. ✅ `sumeru prototype list` 显示默认 prototype
5. ✅ `sumeru session add` 无需预构建镜像
6. ✅ 移除 `pnpm run build:images` 依赖
7. ✅ treespec 测试通过（无 `docker load` 步骤）
8. ✅ 支持本地开发：`adapter add ./packages/sarsapa`
