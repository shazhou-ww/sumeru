import type {
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
} from "@sumeru/adapter-core";
import type { ModelConfig } from "@sumeru/core";
import { createConversation, pushUser } from "./context.js";
import { runLoop } from "./loop.js";
import { defaultTools, toSchemas } from "./tools/index.js";
import type { SarsapaOptions } from "./types.js";
import { DEFAULT_MAX_ITERATIONS } from "./types.js";

function resolveBaseUrl(model: ModelConfig): string | null {
	if (typeof model.provider !== "string") {
		return model.provider.baseUrl;
	}
	return null;
}

function resolveModel(model: ModelConfig): {
	name: string;
	apiKeyEnv: string;
	baseUrl: string | null;
} {
	return {
		name: model.name,
		apiKeyEnv: model.apiKeyEnv,
		baseUrl: resolveBaseUrl(model),
	};
}

export function createSarsapaAdapter(
	options: Partial<SarsapaOptions> = {},
): AdapterImpl {
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	const fetchImpl = options.fetchImpl ?? null;
	const tools = options.tools ?? defaultTools();
	const toolSchemas = toSchemas(tools);

	let initConfig: AdapterInitConfig | null = null;
	let conversation = createConversation("");

	function ensureInit(): AdapterInitConfig {
		if (initConfig === null) {
			throw new Error("sarsapa: handle called before init");
		}
		return initConfig;
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		conversation = createConversation(config.instructions);
	}

	function getNativeId(): string | null {
		return null;
	}

	async function* handle(message: AdapterInboxMessage) {
		const config = ensureInit();
		const m = resolveModel(config.model);
		const cwd = message.project ?? process.cwd();
		pushUser(conversation, message.content);
		return yield* runLoop({
			model: m.name,
			apiKeyEnv: m.apiKeyEnv,
			baseUrl: m.baseUrl,
			conversation,
			tools,
			toolSchemas,
			ctx: { cwd },
			fetchImpl,
			maxIterations,
		});
	}

	return { init, handle, getNativeId };
}
