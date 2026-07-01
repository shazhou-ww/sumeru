import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
	const lastSegment = modelName.includes("/")
		? modelName.split("/").pop()!
		: modelName;
	return lastSegment.toLowerCase();
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

export function runSetup(input: SetupInput): void {
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

	const modelId = deriveModelId(input.model);

	// ── Guard: don't overwrite ──────────────────────────────────────
	const hostYamlPath = join(rootDir, "host.yaml");
	if (existsSync(hostYamlPath)) {
		throw new Error(
			`${hostYamlPath} already exists. Remove it or use a different --root-dir.`,
		);
	}

	// ── Create directory tree ───────────────────────────────────────
	const dirs = [
		rootDir,
		join(rootDir, "data"),
		join(rootDir, "data", "prototypes"),
		join(rootDir, "data", "skills"),
		join(rootDir, "prototypes"),
		join(rootDir, "prototypes", "sarsapa"),
		join(rootDir, "workspace"),
	];
	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
	}

	// ── host.yaml ───────────────────────────────────────────────────
	writeFileSync(
		hostYamlPath,
		`name: sumeru
maxRunning: 3
workspaceRoot: ${rootDir}/workspace
envFile: ${rootDir}/.env
`,
	);

	// ── .env ────────────────────────────────────────────────────────
	const envKey = `${input.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
	writeFileSync(join(rootDir, ".env"), `${envKey}=${input.apiKey}\n`, {
		mode: 0o600,
	});

	// ── data/prototypes/sarsapa.yaml ────────────────────────────────
	writeFileSync(
		join(rootDir, "data", "prototypes", "sarsapa.yaml"),
		`name: sarsapa
persona: default
model: ${modelId}
image: sumeru/sarsapa:dev
`,
	);

	// ── prototypes/sarsapa/compose.yaml ─────────────────────────────
	writeFileSync(
		join(rootDir, "prototypes", "sarsapa", "compose.yaml"),
		`services:
  agent:
    image: sumeru/sarsapa:dev
    mem_limit: 4g
    cpus: 2
    volumes:
      - "\${SUMERU_PROJECT_PATH}:\${SUMERU_PROJECT_PATH}"
    environment:
      - ${envKey}=\${${envKey}}
`,
	);

	// ── SQLite: Provider → Model → Persona ──────────────────────────
	const dbPath = join(rootDir, "data", "sumeru.db");
	const store = openDatabase(dbPath);
	try {
		store.createProvider({
			name: input.provider,
			apiType,
			baseUrl,
			apiKey: input.apiKey,
		});

		store.createModel({
			id: modelId,
			provider: input.provider,
			model: input.model,
			contextWindow: null,
			toolUse: true,
			streaming: true,
			metadata: null,
		});

		store.createPersona({
			name: "default",
			instructions: "You are a helpful coding assistant.",
			skills: [],
		});
	} finally {
		store.close();
	}

	// ── Summary ─────────────────────────────────────────────────────
	process.stdout.write(`Sumeru initialized at ${rootDir}\n\n`);
	process.stdout.write(`  Provider: ${input.provider} (${apiType})\n`);
	if (baseUrl !== null) {
		process.stdout.write(`  Base URL: ${baseUrl}\n`);
	}
	process.stdout.write(`  Model:    ${input.model} → id="${modelId}"\n`);
	process.stdout.write(`  Persona:  default\n\n`);
	process.stdout.write(`Start the server:\n`);
	process.stdout.write(`  sumeru server start\n`);
}
