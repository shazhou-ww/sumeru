import type {
	Model,
	Persona,
	Prototype,
	Provider,
	SessionInfo,
	Turn,
} from "@sumeru/core";

export type HostClientOptions = {
	baseUrl: string;
};

export type Envelope<T> = {
	type: string;
	value: T;
};

export type HostRootValue = {
	name: string;
	version: string;
	status: {
		running: number;
		queued: number;
		idle: number;
	};
	uptime: number;
};

export type ExtensionInfo = {
	name: string;
	description: string;
	dockerfile: string;
};

export type PrototypeListItem = {
	name: string;
};

export type PrototypeDetail = Prototype;

export type CreateSessionBody = {
	prototype: string;
	project: string | null;
	task: string | null;
	model:
		| string
		| { provider: SessionInfo["model"]["provider"]; name: string }
		| null;
	env: Record<string, string> | null;
};

export type HistoryEntry = {
	role: "user" | "assistant" | "tool";
	content: string;
	timestamp: string;
};

export type HistoryValue = {
	sessionId: string;
	messages: Array<HistoryEntry>;
	total: number;
	offset: number;
	limit: number;
};

export type AdapterInfo = {
	name: string;
	providerMode: "custom-only" | "both" | "builtin-only";
	credentialEnv: string | null;
	listModels: boolean;
};

export type BuiltinModel = {
	id: string;
	name: string;
	contextWindow: number | null;
};

export type ProviderApiModel = {
	id: string;
	object: string;
	owned_by: string;
};

export type HostClient = {
	// Root
	getRoot(): Promise<Envelope<HostRootValue>>;

	// Adapters
	listAdapters(): Promise<Envelope<Array<AdapterInfo>>>;
	getAdapter(name: string): Promise<Envelope<AdapterInfo>>;
	listAdapterModels(name: string): Promise<Envelope<Array<BuiltinModel>>>;

	// Prototypes
	listPrototypes(): Promise<Envelope<Array<PrototypeListItem>>>;
	getPrototype(name: string): Promise<Envelope<PrototypeDetail>>;
	addPrototype(
		name: string,
		body: {
			persona: string;
			model: string;
			adapter: string;
		},
	): Promise<Envelope<PrototypeDetail>>;
	updatePrototype(
		name: string,
		body: {
			persona?: string;
			model?: string;
			adapter?: string;
		},
	): Promise<Envelope<PrototypeDetail>>;
	removePrototype(name: string): Promise<void>;

	// Extensions
	listExtensions(): Promise<Envelope<Array<ExtensionInfo>>>;
	getExtension(name: string): Promise<Envelope<ExtensionInfo>>;
	upsertExtension(
		name: string,
		body: { description?: string; dockerfile: string },
	): Promise<Envelope<ExtensionInfo>>;
	removeExtension(name: string): Promise<void>;

	// Providers
	listProviders(): Promise<Envelope<Array<Provider>>>;
	getProvider(name: string): Promise<Envelope<Provider>>;
	addProvider(
		name: string,
		body: {
			apiType: Provider["apiType"];
			baseUrl: string | null;
			apiKey: string | null;
		},
	): Promise<Envelope<Provider>>;
	updateProvider(
		name: string,
		body: {
			apiType?: Provider["apiType"];
			baseUrl?: string | null;
			apiKey?: string | null;
		},
	): Promise<Envelope<Provider>>;
	removeProvider(name: string): Promise<void>;
	listProviderModels(name: string): Promise<Envelope<Array<ProviderApiModel>>>;

	// Models
	listModels(provider?: string): Promise<Envelope<Array<Model>>>;
	getModel(name: string): Promise<Envelope<Model>>;
	upsertModel(
		name: string,
		body: {
			provider?: string;
			model?: string;
			contextWindow?: number | null;
			metadata?: Record<string, unknown> | null;
		},
	): Promise<Envelope<Model>>;
	removeModel(name: string): Promise<void>;

	// Personas
	listPersonas(): Promise<Envelope<Array<Persona>>>;
	getPersona(name: string): Promise<Envelope<Persona>>;
	addPersona(
		name: string,
		body: { instructions: string },
	): Promise<Envelope<Persona>>;
	updatePersona(
		name: string,
		body: { instructions?: string },
	): Promise<Envelope<Persona>>;
	removePersona(name: string): Promise<void>;

	// Skills
	getSkill(name: string): Promise<Envelope<{ name: string; content: string }>>;
	putSkill(
		name: string,
		content: string,
	): Promise<Envelope<{ name: string; content: string }>>;
	removeSkill(name: string): Promise<void>;

	// Sessions
	listSessions(): Promise<Envelope<Array<SessionInfo>>>;
	getSession(id: string): Promise<Envelope<SessionInfo>>;
	addSession(body: CreateSessionBody): Promise<Envelope<SessionInfo>>;
	stopSession(id: string): Promise<Envelope<SessionInfo>>;
	removeSession(id: string): Promise<void>;
	submitMessage(
		id: string,
		body: {
			content: string;
			env: Record<string, string> | null;
			model: CreateSessionBody["model"];
		},
	): Promise<Envelope<{ sessionId: string; messageId: string }>>;
	streamEvents(
		id: string,
		onEvent: (event: string, data: string) => void,
	): Promise<void>;
	getHistory(
		id: string,
		options?: { limit?: number; offset?: number },
	): Promise<Envelope<HistoryValue>>;
	getTurns(
		id: string,
		options?: { after?: number; before?: string; system?: boolean },
	): Promise<Envelope<Array<Turn>>>;
	watchTurns(id: string): Promise<WatchTurnsResult>;
	exportSession(id: string): Promise<ReadableStream<Uint8Array>>;
};

export type WatchTurnsEvent = {
	event: string;
	data: string;
};

export type WatchTurnsResult = {
	connectedAt: string;
	stream: AsyncIterable<WatchTurnsEvent>;
};

export function createHostClient(options: HostClientOptions): HostClient {
	const baseUrl = options.baseUrl.replace(/\/$/, "");

	async function requestJson<T>(
		method: string,
		path: string,
		body: unknown | null,
	): Promise<{ status: number; json: Envelope<T> }> {
		const response = await fetch(`${baseUrl}${path}`, {
			method,
			headers:
				body === null ? undefined : { "Content-Type": "application/json" },
			body: body === null ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		if (text.length === 0) {
			throw new HostClientError(
				response.status,
				"empty_response",
				"Empty response body",
			);
		}
		let json: Envelope<T>;
		try {
			json = JSON.parse(text) as Envelope<T>;
		} catch {
			throw new HostClientError(
				response.status,
				"invalid_json",
				`Invalid JSON response (${response.status})`,
			);
		}
		if (response.status >= 400) {
			const errValue = json.value as { error?: string; message?: string };
			throw new HostClientError(
				response.status,
				errValue.error ?? "request_failed",
				errValue.message ?? `HTTP ${String(response.status)}`,
			);
		}
		return { status: response.status, json };
	}

	async function requestDelete(path: string): Promise<void> {
		const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
		if (response.status === 204) return;
		const text = await response.text();
		if (text.length === 0) {
			throw new HostClientError(
				response.status,
				"request_failed",
				`HTTP ${String(response.status)}`,
			);
		}
		const json = JSON.parse(text) as Envelope<{
			error: string;
			message: string;
		}>;
		const errValue = json.value;
		throw new HostClientError(
			response.status,
			errValue.error,
			errValue.message,
		);
	}

	return {
		// Root
		async getRoot() {
			const { json } = await requestJson<HostRootValue>("GET", "/", null);
			return json;
		},

		// Adapters
		async listAdapters() {
			const { json } = await requestJson<Array<AdapterInfo>>(
				"GET",
				"/adapters",
				null,
			);
			return json;
		},
		async getAdapter(name) {
			const { json } = await requestJson<AdapterInfo>(
				"GET",
				`/adapters/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async listAdapterModels(name) {
			const { json } = await requestJson<Array<BuiltinModel>>(
				"GET",
				`/adapters/${encodeURIComponent(name)}/models`,
				null,
			);
			return json;
		},

		// Prototypes
		async listPrototypes() {
			const { json } = await requestJson<Array<PrototypeListItem>>(
				"GET",
				"/prototypes",
				null,
			);
			return json;
		},
		async getPrototype(name) {
			const { json } = await requestJson<PrototypeDetail>(
				"GET",
				`/prototypes/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async addPrototype(name, body) {
			const { json } = await requestJson<PrototypeDetail>(
				"PUT",
				`/prototypes/${encodeURIComponent(name)}`,
				{ name, ...body },
			);
			return json;
		},
		async updatePrototype(name, body) {
			const { json } = await requestJson<PrototypeDetail>(
				"PUT",
				`/prototypes/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async removePrototype(name) {
			await requestDelete(`/prototypes/${encodeURIComponent(name)}`);
		},

		// Extensions
		async listExtensions() {
			const { json } = await requestJson<Array<ExtensionInfo>>(
				"GET",
				"/extensions",
				null,
			);
			return json;
		},
		async getExtension(name) {
			const { json } = await requestJson<ExtensionInfo>(
				"GET",
				`/extensions/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async upsertExtension(name, body) {
			const { json } = await requestJson<ExtensionInfo>(
				"PUT",
				`/extensions/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async removeExtension(name) {
			await requestDelete(`/extensions/${encodeURIComponent(name)}`);
		},

		// Providers
		async listProviders() {
			const { json } = await requestJson<Array<Provider>>(
				"GET",
				"/providers",
				null,
			);
			return json;
		},
		async getProvider(name) {
			const { json } = await requestJson<Provider>(
				"GET",
				`/providers/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async addProvider(name, body) {
			const { json } = await requestJson<Provider>(
				"PUT",
				`/providers/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async updateProvider(name, body) {
			const { json } = await requestJson<Provider>(
				"PUT",
				`/providers/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async removeProvider(name) {
			await requestDelete(`/providers/${encodeURIComponent(name)}`);
		},
		async listProviderModels(name) {
			const { json } = await requestJson<Array<ProviderApiModel>>(
				"GET",
				`/providers/${encodeURIComponent(name)}/models`,
				null,
			);
			return json;
		},

		// Models
		async listModels(provider) {
			const path =
				provider === undefined
					? "/models"
					: `/models?provider=${encodeURIComponent(provider)}`;
			const { json } = await requestJson<Array<Model>>("GET", path, null);
			return json;
		},
		async getModel(name) {
			const { json } = await requestJson<Model>(
				"GET",
				`/models/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async upsertModel(name, body) {
			const { json } = await requestJson<Model>(
				"PUT",
				`/models/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async removeModel(name) {
			await requestDelete(`/models/${encodeURIComponent(name)}`);
		},

		// Personas
		async listPersonas() {
			const { json } = await requestJson<Array<Persona>>(
				"GET",
				"/personas",
				null,
			);
			return json;
		},
		async getPersona(name) {
			const { json } = await requestJson<Persona>(
				"GET",
				`/personas/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async addPersona(name, body) {
			const { json } = await requestJson<Persona>(
				"PUT",
				`/personas/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async updatePersona(name, body) {
			const { json } = await requestJson<Persona>(
				"PUT",
				`/personas/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async removePersona(name) {
			await requestDelete(`/personas/${encodeURIComponent(name)}`);
		},

		// Skills
		async getSkill(name) {
			const { json } = await requestJson<{ name: string; content: string }>(
				"GET",
				`/skills/${encodeURIComponent(name)}`,
				null,
			);
			return json;
		},
		async putSkill(name, content) {
			const { json } = await requestJson<{ name: string; content: string }>(
				"PUT",
				`/skills/${encodeURIComponent(name)}`,
				{ content },
			);
			return json;
		},
		async removeSkill(name) {
			await requestDelete(`/skills/${encodeURIComponent(name)}`);
		},

		// Sessions
		async listSessions() {
			const { json } = await requestJson<Array<SessionInfo>>(
				"GET",
				"/sessions",
				null,
			);
			return json;
		},
		async getSession(id) {
			const { json } = await requestJson<SessionInfo>(
				"GET",
				`/sessions/${encodeURIComponent(id)}`,
				null,
			);
			return json;
		},
		async addSession(body) {
			const { json } = await requestJson<SessionInfo>(
				"POST",
				"/sessions",
				body,
			);
			return json;
		},
		async stopSession(id) {
			const { json } = await requestJson<SessionInfo>(
				"POST",
				`/sessions/${encodeURIComponent(id)}/stop`,
				null,
			);
			return json;
		},
		async removeSession(id) {
			await requestDelete(`/sessions/${encodeURIComponent(id)}`);
		},
		async submitMessage(id, body) {
			const { json } = await requestJson<{
				sessionId: string;
				messageId: string;
			}>("POST", `/sessions/${encodeURIComponent(id)}/messages`, body);
			return json;
		},
		async streamEvents(id, onEvent) {
			const response = await fetch(
				`${baseUrl}/sessions/${encodeURIComponent(id)}/events`,
				{ headers: { Accept: "text/event-stream" } },
			);
			if (!response.ok) {
				const text = await response.text();
				if (text.length > 0) {
					const json = JSON.parse(text) as Envelope<{
						error: string;
						message: string;
					}>;
					throw new HostClientError(
						response.status,
						json.value.error,
						json.value.message,
					);
				}
				throw new HostClientError(
					response.status,
					"request_failed",
					`HTTP ${String(response.status)}`,
				);
			}
			const body = response.body;
			if (body === null) {
				throw new HostClientError(500, "no_body", "SSE response has no body");
			}
			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				buffer = consumeSseBuffer(buffer, onEvent);
			}
		},
		async getHistory(id, historyOptions) {
			const params = new URLSearchParams();
			if (historyOptions?.limit !== undefined) {
				params.set("limit", String(historyOptions.limit));
			}
			if (historyOptions?.offset !== undefined) {
				params.set("offset", String(historyOptions.offset));
			}
			const qs = params.toString();
			const path = `/sessions/${encodeURIComponent(id)}/history${qs ? `?${qs}` : ""}`;
			const { json } = await requestJson<HistoryValue>("GET", path, null);
			return json;
		},
		async getTurns(id, turnsOptions) {
			const params = new URLSearchParams();
			if (turnsOptions?.after !== undefined) {
				params.set("after", String(turnsOptions.after));
			}
			if (turnsOptions?.before !== undefined) {
				params.set("before", turnsOptions.before);
			}
			if (turnsOptions?.system === true) {
				params.set("system", "true");
			}
			const qs = params.toString();
			const path = `/sessions/${encodeURIComponent(id)}/turns${qs ? `?${qs}` : ""}`;
			const { json } = await requestJson<Array<Turn>>("GET", path, null);
			return json;
		},
		async watchTurns(id) {
			const response = await fetch(
				`${baseUrl}/sessions/${encodeURIComponent(id)}/turns/watch`,
				{ headers: { Accept: "text/event-stream" } },
			);
			if (!response.ok) {
				const text = await response.text();
				if (text.length > 0) {
					const json = JSON.parse(text) as Envelope<{
						error: string;
						message: string;
					}>;
					throw new HostClientError(
						response.status,
						json.value.error,
						json.value.message,
					);
				}
				throw new HostClientError(
					response.status,
					"request_failed",
					`HTTP ${String(response.status)}`,
				);
			}
			const body = response.body;
			if (body === null) {
				throw new HostClientError(500, "no_body", "SSE response has no body");
			}
			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let connectedAt = "";
			const pending: Array<WatchTurnsEvent> = [];
			let streamDone = false;
			let notify: (() => void) | null = null;

			const wake = (): void => {
				notify?.();
				notify = null;
			};

			const waitForEvent = (): Promise<void> =>
				new Promise((resolve) => {
					notify = resolve;
				});

			const onSseEvent = (event: string, data: string): void => {
				if (event === "connected" && connectedAt.length === 0) {
					const parsed = JSON.parse(data) as { ts: string };
					connectedAt = parsed.ts;
					wake();
					return;
				}
				pending.push({ event, data });
				wake();
			};

			const pump = async (): Promise<void> => {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						streamDone = true;
						wake();
						return;
					}
					buffer += decoder.decode(value, { stream: true });
					buffer = consumeSseBuffer(buffer, onSseEvent);
				}
			};

			void pump();

			while (connectedAt.length === 0 && !streamDone) {
				await waitForEvent();
			}
			if (connectedAt.length === 0) {
				throw new HostClientError(
					500,
					"no_connected",
					"SSE stream ended before connected event",
				);
			}

			const stream = (async function* (): AsyncGenerator<WatchTurnsEvent> {
				while (true) {
					while (pending.length > 0) {
						const evt = pending.shift();
						if (evt !== undefined) {
							yield evt;
						}
					}
					if (streamDone) return;
					await waitForEvent();
				}
			})();

			return { connectedAt, stream };
		},
		async exportSession(id) {
			const response = await fetch(
				`${baseUrl}/sessions/${encodeURIComponent(id)}/export`,
				{ method: "POST" },
			);
			if (!response.ok) {
				const text = await response.text();
				if (text.length > 0) {
					const json = JSON.parse(text) as Envelope<{
						error: string;
						message: string;
					}>;
					throw new HostClientError(
						response.status,
						json.value.error,
						json.value.message,
					);
				}
				throw new HostClientError(
					response.status,
					"request_failed",
					`HTTP ${String(response.status)}`,
				);
			}
			if (response.body === null) {
				throw new HostClientError(
					500,
					"no_body",
					"Export response has no body",
				);
			}
			return response.body;
		},
	};
}

export class HostClientError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "HostClientError";
		this.status = status;
		this.code = code;
	}
}

function consumeSseBuffer(
	buffer: string,
	onEvent: (event: string, data: string) => void,
): string {
	const blocks = buffer.split("\n\n");
	const remainder = blocks.pop() ?? "";
	for (const block of blocks) {
		const parsed = parseSseBlock(block);
		if (parsed !== null) {
			onEvent(parsed.event, parsed.data);
		}
	}
	return remainder;
}

function parseSseBlock(block: string): { event: string; data: string } | null {
	const lines = block.split("\n");
	let event = "message";
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trim());
		}
	}
	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}
