import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { openDatabase } from "@sumeru/host/sqlite";

// ── Provider presets ────────────────────────────────────────────────
type ProviderPreset = {
	apiType: "openai" | "anthropic";
	baseUrl: string | null;
};

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
	anthropic: { apiType: "anthropic", baseUrl: null },
	openai: { apiType: "openai", baseUrl: null },
	openrouter: {
		apiType: "openai",
		baseUrl: "https://openrouter.ai/api/v1",
	},
	siliconflow: {
		apiType: "openai",
		baseUrl: "https://api.siliconflow.cn/v1",
	},
	deepseek: { apiType: "openai", baseUrl: "https://api.deepseek.com" },
};

// ── Model ID derivation ────────────────────────────────────────────
function deriveModelId(modelName: string): string {
	// "deepseek-ai/DeepSeek-V3" → "deepseek-v3"
	// "claude-sonnet-4-20250514" → "claude-sonnet-4-20250514"
	const parts = modelName.split("/");
	const lastSegment = modelName.includes("/")
		? parts[parts.length - 1]
		: modelName;
	return lastSegment.toLowerCase();
}

// ── .env upsert helper ─────────────────────────────────────────────
function upsertEnvFile(envPath: string, key: string, value: string): void {
	let lines: Array<string> = [];
	if (existsSync(envPath)) {
		lines = readFileSync(envPath, "utf-8").split("\n");
	}
	const prefix = `${key}=`;
	const idx = lines.findIndex((l) => l.startsWith(prefix));
	const entry = `${key}=${value}`;
	if (idx >= 0) {
		lines[idx] = entry;
	} else {
		// Append before trailing empty line
		if (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.splice(lines.length - 1, 0, entry);
		} else {
			lines.push(entry);
		}
	}
	// Ensure trailing newline
	const content = `${lines.filter((l, i) => i < lines.length - 1 || l !== "").join("\n")}\n`;
	writeFileSync(envPath, content, { mode: 0o600 });
}

// ── Setup input ─────────────────────────────────────────────────────
export type SetupInput = {
	provider: string;
	apiKey: string;
	model: string;
	apiType: string | null;
	baseUrl: string | null;
	rootDir: string | null;
};

export async function runSetup(input: SetupInput): Promise<void> {
	const rootDir = input.rootDir ?? join(homedir(), ".sumeru");

	// ── Resolve provider preset ─────────────────────────────────────
	const preset = PROVIDER_PRESETS[input.provider];
	let apiType: "openai" | "anthropic";
	let baseUrl: string | null;

	if (preset !== undefined) {
		apiType = (input.apiType as "openai" | "anthropic") ?? preset.apiType;
		baseUrl = input.baseUrl ?? preset.baseUrl;
	} else {
		// Custom provider — require apiType
		if (input.apiType === null) {
			throw new Error(
				`Unknown provider "${input.provider}". For custom providers, pass --api-type (openai | anthropic) and --base-url.`,
			);
		}
		if (input.apiType !== "openai" && input.apiType !== "anthropic") {
			throw new Error('--api-type must be "openai" or "anthropic"');
		}
		apiType = input.apiType;
		baseUrl = input.baseUrl;
	}

	const modelName = deriveModelId(input.model);
	const modelRef = `${input.provider}:${modelName}`;
	const isUpdate = existsSync(join(rootDir, "host.yaml"));
	const actions: Array<string> = [];

	// ── Create directory tree ───────────────────────────────────────
	const dirs = [
		rootDir,
		join(rootDir, "data"),
		join(rootDir, "data", "prototypes"),
		join(rootDir, "data", "skills"),
		join(rootDir, "data", "extensions"),
		join(rootDir, "prototypes"),
		join(rootDir, "prototypes", "sarsapa"),
		join(rootDir, "workspace"),
	];
	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
	}

	// ── host.yaml (create only, never overwrite) ────────────────────
	const hostYamlPath = join(rootDir, "host.yaml");
	if (!existsSync(hostYamlPath)) {
		writeFileSync(
			hostYamlPath,
			`name: sumeru\nmaxRunning: 3\nworkspaceRoot: ${rootDir}/workspace\nenvFile: ${rootDir}/.env\ndefaults:\n  model: ${modelRef}\n`,
		);
		actions.push("created host.yaml");
	}

	// ── .env (upsert key) ───────────────────────────────────────────
	const envKey = `${input.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
	const envPath = join(rootDir, ".env");
	upsertEnvFile(envPath, envKey, input.apiKey);
	actions.push(`${isUpdate ? "updated" : "created"} .env (${envKey})`);

	// ── data/prototypes/sarsapa.yaml (create only) ──────────────────
	const protoYamlPath = join(rootDir, "data", "prototypes", "sarsapa.yaml");
	if (!existsSync(protoYamlPath)) {
		writeFileSync(
			protoYamlPath,
			`name: sarsapa\npersona: default\nmodel: ${modelRef}\nadapter: sarsapa\n`,
		);
		actions.push("created data/prototypes/sarsapa.yaml");
	}

	// ── prototypes/sarsapa/compose.yaml (create only) ───────────────
	const cacheDir = join(rootDir, "cache");
	mkdirSync(join(cacheDir, "pnpm-store"), { recursive: true });
	mkdirSync(join(cacheDir, "npm"), { recursive: true });
	mkdirSync(join(cacheDir, "uv"), { recursive: true });
	mkdirSync(join(cacheDir, "pip"), { recursive: true });
	const composePath = join(rootDir, "prototypes", "sarsapa", "compose.yaml");
	if (!existsSync(composePath)) {
		writeFileSync(
			composePath,
			`services:\n  agent:\n    image: sumeru/sarsapa:dev\n    mem_limit: 4g\n    cpus: 2\n    volumes:\n      - "\${SUMERU_PROJECT_PATH}:\${SUMERU_PROJECT_PATH}"\n      - "${cacheDir}/pnpm-store:/cache/pnpm-store"\n      - "${cacheDir}/npm:/cache/npm"\n      - "${cacheDir}/uv:/cache/uv"\n      - "${cacheDir}/pip:/cache/pip"\n    environment:\n      - ${envKey}=\${${envKey}}\n    logging:\n      driver: json-file\n      options:\n        max-size: "10m"\n        max-file: "2"\n    network_mode: host\n`,
		);
		actions.push("created prototypes/sarsapa/compose.yaml");
	}

	// ── Seed builtin skills ──────────────────────────────────────────
	const skillsDir = join(rootDir, "data", "skills");
	mkdirSync(skillsDir, { recursive: true });
	const sumeruSkillPath = join(skillsDir, "sumeru.md");
	if (!existsSync(sumeruSkillPath)) {
		writeFileSync(
			sumeruSkillPath,
			`# Sumeru

You are running inside Sumeru — an agent runtime that manages your lifecycle.

## Key facts

- You communicate via NDJSON stdin/stdout protocol (adapter-core handles this)
- Your working directory is the project path passed with each message
- You have tools: read_file, write_file, patch, terminal, search_files
- Terminal commands run in your container (Docker)
- npm install may be slow — use \`--registry=https://registry.npmmirror.com\` and \`timeout: 180000\`

## Task completion

When done, output a clear summary:
- What was accomplished
- Test results (pass/fail counts)
- Any files created or modified

## Conventions

- TypeScript: strict mode, .js extensions in imports, function over class
- Tests: vitest, write tests first (TDD)
- Formatting: biome (no prettier/eslint)
- Package manager: pnpm
`,
		);
		actions.push("created data/skills/sumeru.md");
	}

	// ── Seed builtin extensions ──────────────────────────────────────
	const extensionsDir = join(rootDir, "data", "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const builtinExtensions: Record<string, string> = {
		python: `name: python
description: Python 3 runtime with pip
dockerfile: |
  RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*
`,
		node: `name: node
description: pnpm package manager (Node.js already in base image)
dockerfile: |
  RUN corepack enable && corepack prepare pnpm@latest --activate
`,
		rust: `name: rust
description: Rust toolchain (rustc + cargo) installed to /usr/local
dockerfile: |
  ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
  RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  ENV PATH="/usr/local/cargo/bin:\${PATH}"
`,
		docker: `name: docker
description: Docker CLI (for Docker-in-Docker or remote daemon)
dockerfile: |
  RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
`,
		playwright: `name: playwright
description: Playwright browser automation with Chromium (installed to /opt/playwright)
dockerfile: |
  ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
  RUN npx playwright install --with-deps chromium
`,
	};
	for (const [name, content] of Object.entries(builtinExtensions)) {
		const extPath = join(extensionsDir, `${name}.yaml`);
		if (!existsSync(extPath)) {
			writeFileSync(extPath, content);
			actions.push(`created data/extensions/${name}.yaml`);
		}
	}

	// ── SQLite: upsert Provider → Model → Persona ───────────────────
	const dbPath = join(rootDir, "data", "sumeru.db");
	const store = openDatabase(dbPath);
	try {
		// Provider: update if exists, create if not
		const existingProvider = store.getProvider(input.provider);
		if (existingProvider !== null) {
			store.updateProvider(input.provider, {
				apiType,
				baseUrl,
				apiKey: input.apiKey,
			});
			actions.push(`updated provider "${input.provider}"`);
		} else {
			store.createProvider({
				name: input.provider,
				apiType,
				baseUrl,
				apiKey: input.apiKey,
			});
			actions.push(`created provider "${input.provider}"`);
		}

		// Model: update if exists, create if not
		const existingModel = store.getModel(input.provider, modelName);
		if (existingModel !== null) {
			store.updateModel(input.provider, modelName, {
				model: input.model,
				contextWindow: null,
				toolUse: true,
				streaming: true,
				metadata: null,
			});
			actions.push(`updated model "${modelRef}"`);
		} else {
			store.createModel({
				provider: input.provider,
				name: modelName,
				model: input.model,
				contextWindow: null,
				toolUse: true,
				streaming: true,
				metadata: null,
			});
			actions.push(`created model "${modelRef}"`);
		}

		// Persona: create only if not exists
		const existingPersona = store.getPersona("default");
		if (existingPersona === null) {
			store.createPersona({
				name: "default",
				instructions:
					"You are a senior software engineer. Write clean, well-tested code following best practices. Use strict TypeScript types, prefer functions over classes, write tests before implementation (TDD). Report results with test pass count and key outputs.",
			});
			actions.push('created persona "default"');
		}
	} finally {
		store.close();
	}

	// ── Summary ─────────────────────────────────────────────────────
	process.stdout.write(
		isUpdate
			? `Sumeru updated at ${rootDir}\n\n`
			: `Sumeru initialized at ${rootDir}\n\n`,
	);
	process.stdout.write(`  Provider: ${input.provider} (${apiType})\n`);
	if (baseUrl !== null) {
		process.stdout.write(`  Base URL: ${baseUrl}\n`);
	}
	process.stdout.write(`  Model:    ${input.model} → id="${modelRef}"\n`);
	process.stdout.write(`  Persona:  default\n\n`);
	process.stdout.write(`Actions:\n`);
	for (const action of actions) {
		process.stdout.write(`  • ${action}\n`);
	}
	if (!isUpdate) {
		process.stdout.write(`\nStart the server:\n`);
		process.stdout.write(`  sumeru server start\n`);
	}

	// ── Image build (best-effort) ────────────────────────────────────
	let imageBuilt = false;
	try {
		const repoRoot = await findRepoRoot(process.cwd());
		process.stdout.write(`\nBuilding sarsapa image...\n`);
		const result = await runImageBuildLocal({
			name: "sarsapa",
			agent: "sarsapa",
			adapter: null,
			repoRoot,
		});
		actions.push(`built image "sarsapa" (${result.tag})`);
		process.stdout.write(`  ✓ Image built: ${result.tag}\n`);
		imageBuilt = true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stdout.write(
			`\n⚠ Image build skipped: ${msg}\n  Run later: sumeru image build sarsapa --agent sarsapa\n`,
		);
	}

	if (imageBuilt) {
		process.stdout.write(`  ✓ Prototype "sarsapa" ready\n`);
	}

	// ── Health check (doctor) ────────────────────────────────────────
	if (imageBuilt) {
		await runHealthCheck({
			composePath,
			rootDir,
			envKey,
			apiKey: input.apiKey,
			baseUrl,
			apiType,
			model: input.model,
		});
	}
}

// ── Local image build (no host API needed) ────────────────────────────

type LocalBuildOptions = {
	name: string;
	agent: string;
	adapter: string | null;
	repoRoot: string;
};

async function runImageBuildLocal(
	options: LocalBuildOptions,
): Promise<{ tag: string; digest: string }> {
	const agent = options.agent;
	const adapterPath = options.adapter
		? isAbsolute(options.adapter)
			? options.adapter
			: resolve(options.repoRoot, options.adapter)
		: agent === "sarsapa"
			? join(options.repoRoot, "packages/sarsapa")
			: join(options.repoRoot, `packages/adapter-${agent}`);

	const dockerTag = `sumeru/${options.name}:dev`;
	const dockerfileSource = join(adapterPath, "Dockerfile");
	const buildDir = join(options.repoRoot, ".build");
	const packagesDir = join(buildDir, "packages");

	await rm(buildDir, { recursive: true, force: true });
	await mkdir(packagesDir, { recursive: true });

	// Copy core + adapter-core + agent adapter
	await copyPkg(
		join(options.repoRoot, "packages/core"),
		join(packagesDir, "core"),
	);
	await copyPkg(
		join(options.repoRoot, "packages/adapter-core"),
		join(packagesDir, "adapter-core"),
	);
	const adapterDest = agent === "sarsapa" ? "sarsapa" : `adapter-${agent}`;
	await copyPkg(adapterPath, join(packagesDir, adapterDest));

	await cp(dockerfileSource, join(buildDir, "Dockerfile"));
	const dockerignore = join(options.repoRoot, ".dockerignore");
	try {
		await cp(dockerignore, join(buildDir, ".dockerignore"));
	} catch {
		// optional
	}

	const buildResult = spawnSync(
		"docker",
		["build", "-t", dockerTag, "-f", "Dockerfile", "."],
		{ cwd: buildDir, encoding: "utf-8", stdio: "inherit" },
	);
	if (buildResult.error !== undefined) {
		throw new Error(`docker build failed: ${buildResult.error.message}`);
	}
	if (buildResult.status !== 0) {
		throw new Error(
			`docker build exited with code ${String(buildResult.status)}`,
		);
	}

	// Get digest
	const inspectResult = spawnSync(
		"docker",
		["inspect", "--format", "{{.Id}}", dockerTag],
		{ encoding: "utf-8" },
	);
	const digest =
		inspectResult.status === 0 ? inspectResult.stdout.trim() : "unknown";

	return { tag: dockerTag, digest };
}

async function copyPkg(srcDir: string, destDir: string): Promise<void> {
	await mkdir(join(destDir, "dist"), { recursive: true });
	await cp(join(srcDir, "package.json"), join(destDir, "package.json"));
	await cp(join(srcDir, "dist"), join(destDir, "dist"), { recursive: true });
}

async function findRepoRoot(startDir: string): Promise<string> {
	let current = resolve(startDir);
	for (;;) {
		try {
			await access(join(current, "pnpm-workspace.yaml"));
			return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) {
				throw new Error(
					"Could not find monorepo root (pnpm-workspace.yaml). Run from the sumeru repository.",
				);
			}
			current = parent;
		}
	}
}

// ── Health check (doctor integrated into setup) ───────────────────────

type HealthCheckOptions = {
	composePath: string;
	rootDir: string;
	envKey: string;
	apiKey: string;
	baseUrl: string | null;
	apiType: "openai" | "anthropic";
	model: string;
};

async function runHealthCheck(options: HealthCheckOptions): Promise<void> {
	process.stdout.write(`\nHealth check:\n`);
	const projectName = "sumeru-healthcheck";

	// Step 1: Can we start the container?
	const env = {
		...process.env,
		SUMERU_PROJECT_PATH: "/tmp",
		[options.envKey]: options.apiKey,
	};
	const upResult = spawnSync(
		"docker",
		["compose", "-f", options.composePath, "-p", projectName, "up", "-d"],
		{ encoding: "utf-8", env, timeout: 30_000 },
	);
	if (upResult.status !== 0) {
		process.stdout.write(
			`  ✗ Container failed to start\n    ${(upResult.stderr ?? upResult.stdout ?? "").trim()}\n`,
		);
		return;
	}
	process.stdout.write(`  ✓ Container starts successfully\n`);

	// Step 2: Send a minimal LLM request from inside the container
	const containerName = `${projectName}-agent-1`;
	spawnSync("sleep", ["1"]);

	const curlArgs = buildLlmProbeArgs(options);
	const curlResult = spawnSync(
		"docker",
		["exec", containerName, "curl", ...curlArgs],
		{ encoding: "utf-8", timeout: 30_000 },
	);

	const output = curlResult.stdout?.trim() ?? "";
	const stderr = curlResult.stderr?.trim() ?? "";

	if (curlResult.status === 0 && !output.includes('"error"')) {
		process.stdout.write(`  ✓ LLM probe succeeded (model: ${options.model})\n`);
	} else {
		// Try to extract error message
		let errorMsg = "";
		try {
			const parsed = JSON.parse(output) as Record<string, unknown>;
			const errObj = parsed.error as Record<string, unknown> | undefined;
			errorMsg = String(errObj?.message ?? parsed.message ?? output);
		} catch {
			errorMsg = output || stderr;
		}
		process.stdout.write(
			`  ✗ LLM probe failed (model: ${options.model})\n    ${errorMsg}\n    Hint: verify API key, model name, and network access\n`,
		);
	}

	// Cleanup
	spawnSync(
		"docker",
		[
			"compose",
			"-f",
			options.composePath,
			"-p",
			projectName,
			"down",
			"-t",
			"2",
		],
		{ encoding: "utf-8", env, timeout: 15_000 },
	);
}

function buildLlmProbeArgs(options: HealthCheckOptions): Array<string> {
	if (options.apiType === "anthropic") {
		const url = options.baseUrl ?? "https://api.anthropic.com";
		const body = JSON.stringify({
			model: options.model,
			max_tokens: 1,
			messages: [{ role: "user", content: "hi" }],
		});
		return [
			"-s",
			"--max-time",
			"15",
			"-X",
			"POST",
			`${url}/v1/messages`,
			"-H",
			"Content-Type: application/json",
			"-H",
			`x-api-key: ${options.apiKey}`,
			"-H",
			"anthropic-version: 2023-06-01",
			"-d",
			body,
		];
	}
	// OpenAI-compatible
	const url = options.baseUrl ?? "https://api.openai.com/v1";
	const body = JSON.stringify({
		model: options.model,
		max_tokens: 1,
		messages: [{ role: "user", content: "hi" }],
	});
	return [
		"-s",
		"--max-time",
		"15",
		"-X",
		"POST",
		`${url}/chat/completions`,
		"-H",
		"Content-Type: application/json",
		"-H",
		`Authorization: Bearer ${options.apiKey}`,
		"-d",
		body,
	];
}
