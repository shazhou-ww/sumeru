import type { LlmMessage } from "../types.js";
import { parseToolCalls } from "./parse.js";
import type { LlmRequest, LlmResponse } from "./types.js";

type OpenAiMessage = {
	role: string;
	content: string;
	tool_calls?: unknown;
	tool_call_id?: string;
};

function toOpenAiMessage(msg: LlmMessage): OpenAiMessage {
	const out: OpenAiMessage = { role: msg.role, content: msg.content };
	if (msg.toolCalls !== null) {
		out.tool_calls = msg.toolCalls.map((c) => ({
			id: c.id,
			type: "function",
			function: { name: c.name, arguments: c.arguments },
		}));
	}
	if (msg.toolCallId !== null) {
		out.tool_call_id = msg.toolCallId;
	}
	return out;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function providerDefaultBaseUrl(provider: string): string {
	if (provider === "openrouter") return OPENROUTER_DEFAULT_BASE_URL;
	return OPENAI_DEFAULT_BASE_URL;
}

export async function chat(request: LlmRequest): Promise<LlmResponse> {
	const apiKey = process.env[request.apiKeyEnv] ?? "";
	if (apiKey.length === 0) {
		throw new Error(`sarsapa: env var ${request.apiKeyEnv} is not set`);
	}
	const baseUrl = request.baseUrl ?? OPENAI_DEFAULT_BASE_URL;
	const fetchFn = request.fetchImpl ?? fetch;

	const body: Record<string, unknown> = {
		model: request.model,
		messages: request.messages.map(toOpenAiMessage),
		stream: false,
	};
	if (request.tools.length > 0) {
		body.tools = request.tools;
	}

	const res = await fetchFn(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal: request.signal ?? undefined,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`sarsapa: llm chat failed (${res.status}): ${text}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	const choices = data.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error("sarsapa: llm returned no choices");
	}
	const choice = choices[0] as Record<string, unknown>;
	const message = choice.message as Record<string, unknown>;
	const content = typeof message.content === "string" ? message.content : "";
	const toolCalls = parseToolCalls(message.tool_calls);

	const usage = data.usage;
	let tokens: { input: number; output: number } | null = null;
	if (
		typeof usage === "object" &&
		usage !== null &&
		typeof (usage as Record<string, unknown>).prompt_tokens === "number" &&
		typeof (usage as Record<string, unknown>).completion_tokens === "number"
	) {
		const u = usage as Record<string, unknown>;
		tokens = {
			input: u.prompt_tokens as number,
			output: u.completion_tokens as number,
		};
	}

	return { content, toolCalls, tokens };
}

export { providerDefaultBaseUrl };
