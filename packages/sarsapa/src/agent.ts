import type {
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
} from "@sumeru/adapter-core";
import type { ModelConfig } from "@sumeru/core";
import { createConversation, pushUser } from "./context.js";
import { runLoop } from "./loop.js";
import { createSessionStore, DEFAULT_SESSION_PATH } from "./session-store.js";
import { defaultTools, toSchemas } from "./tools/index.js";
import type { SarsapaOptions } from "./types.js";
import { DEFAULT_MAX_ITERATIONS } from "./types.js";

function resolveBaseUrl(model: ModelConfig): string | null {
	if (typeof model.provider !== "string") {
		return model.provider.endpoint;
	}
	return null;
}

function resolveModel(model: ModelConfig): {
	name: string;
	apiKey: string;
	baseUrl: string | null;
} {
	return {
		name: model.name,
		apiKey: model.apiKey ?? "",
		baseUrl: resolveBaseUrl(model),
	};
}

function buildSystemPrompt(config: AdapterInitConfig): string {
	let system = config.instructions;
	if (config.skills.length > 0) {
		const skillsSection = config.skills
			.map((s) => `## Skill: ${s.name}\n\n${s.content}`)
			.join("\n\n");
		system = `${system}\n\n# Available Skills\n\n${skillsSection}`;
	}
	return system;
}

export function createSarsapaAdapter(
	options: Partial<SarsapaOptions> = {},
): AdapterImpl {
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	const fetchImpl = options.fetchImpl ?? null;
	const tools = options.tools ?? defaultTools();
	const toolSchemas = toSchemas(tools);
	const sessionStore = createSessionStore(
		options.sessionPath ?? DEFAULT_SESSION_PATH,
	);

	let initConfig: AdapterInitConfig | null = null;
	let conversation = createConversation("");

	function ensureInit(): AdapterInitConfig {
		if (initConfig === null) {
			throw new Error("sarsapa: handle called before init");
		}
		return initConfig;
	}

	function restoreFromStore(): boolean {
		const stored = sessionStore.load();
		if (stored === null) return false;
		initConfig = {
			instructions: "",
			skills: [],
			model: stored.model,
		};
		conversation = createConversation(stored.system);
		conversation.turns.push(...stored.turns);
		return true;
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		const system = buildSystemPrompt(config);
		conversation = createConversation(system);
		sessionStore.writeInit(system, config);
	}

	function resume(): boolean {
		return restoreFromStore();
	}

	function getNativeId(): string | null {
		return null;
	}

	async function* handle(message: AdapterInboxMessage) {
		const config = ensureInit();
		const m = resolveModel(config.model);
		const cwd = message.project ?? process.cwd();
		pushUser(conversation, message.content);
		const userTurn = conversation.turns[conversation.turns.length - 1];
		if (userTurn !== undefined) {
			sessionStore.appendMessage(userTurn);
		}
		return yield* runLoop({
			model: m.name,
			apiKey: m.apiKey,
			baseUrl: m.baseUrl,
			conversation,
			tools,
			toolSchemas,
			ctx: { cwd },
			fetchImpl,
			maxIterations,
			persistMessage: (msg) => {
				sessionStore.appendMessage(msg);
			},
		});
	}

	return { init, handle, resume, getNativeId };
}
