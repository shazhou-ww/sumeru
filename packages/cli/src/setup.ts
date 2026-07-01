import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
	const isUpdate = existsSync(join(rootDir, "host.yaml"));
	const actions: Array<string> = [];

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

	// ── host.yaml (create only, never overwrite) ────────────────────
	const hostYamlPath = join(rootDir, "host.yaml");
	if (!existsSync(hostYamlPath)) {
		writeFileSync(
			hostYamlPath,
			`name: sumeru\nmaxRunning: 3\nworkspaceRoot: ${rootDir}/workspace\nenvFile: ${rootDir}/.env\n`,
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
			`name: sarsapa\npersona: default\nmodel: ${modelId}\nimage: sumeru/sarsapa:dev\n`,
		);
		actions.push("created data/prototypes/sarsapa.yaml");
	}

	// ── prototypes/sarsapa/compose.yaml (create only) ───────────────
	const composePath = join(rootDir, "prototypes", "sarsapa", "compose.yaml");
	if (!existsSync(composePath)) {
		writeFileSync(
			composePath,
			`services:\n  agent:\n    image: sumeru/sarsapa:dev\n    mem_limit: 4g\n    cpus: 2\n    volumes:\n      - "\${SUMERU_PROJECT_PATH}:\${SUMERU_PROJECT_PATH}"\n    environment:\n      - ${envKey}=\${${envKey}}\n`,
		);
		actions.push("created prototypes/sarsapa/compose.yaml");
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
		const existingModel = store.getModel(modelId);
		if (existingModel !== null) {
			store.updateModel(modelId, {
				provider: input.provider,
				model: input.model,
				contextWindow: null,
				toolUse: true,
				streaming: true,
				metadata: null,
			});
			actions.push(`updated model "${modelId}"`);
		} else {
			store.createModel({
				id: modelId,
				provider: input.provider,
				model: input.model,
				contextWindow: null,
				toolUse: true,
				streaming: true,
				metadata: null,
			});
			actions.push(`created model "${modelId}"`);
		}

		// Persona: create only if not exists
		const existingPersona = store.getPersona("default");
		if (existingPersona === null) {
			store.createPersona({
				name: "default",
				instructions: "You are a helpful coding assistant.",
				skills: [],
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
	process.stdout.write(`  Model:    ${input.model} → id="${modelId}"\n`);
	process.stdout.write(`  Persona:  default\n\n`);
	process.stdout.write(`Actions:\n`);
	for (const action of actions) {
		process.stdout.write(`  • ${action}\n`);
	}
	if (!isUpdate) {
		process.stdout.write(`\nStart the server:\n`);
		process.stdout.write(`  sumeru server start\n`);
	}
}
