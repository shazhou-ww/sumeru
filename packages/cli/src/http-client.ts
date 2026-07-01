import type { Model, Provider, SessionInfo } from "@sumeru/core";

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

export type PrototypeListItem = {
	name: string;
};

export type PrototypeDetail = {
	name: string;
	prototype: {
		name: string;
		persona: string;
		model: string;
		image: string;
		defaults: {
			maxTurns: number;
			timeout: number;
			resources: { cpu: number; memory: string };
		} | null;
	};
};

export type CreateSessionBody = {
	prototype: string;
	project: string;
	task: string;
	model: { provider: SessionInfo["model"]["provider"]; name: string } | null;
	env: Record<string, string> | null;
};

export type HostClient = {
	getRoot(): Promise<Envelope<HostRootValue>>;
	listPrototypes(): Promise<Envelope<Array<PrototypeListItem>>>;
	createPrototype(
		name: string,
		body: {
			persona: string;
			model: string;
			image: string;
		},
	): Promise<Envelope<PrototypeDetail>>;
	deletePrototype(name: string): Promise<void>;
	listProviders(): Promise<Envelope<Array<Provider>>>;
	createProvider(
		name: string,
		body: {
			apiType: Provider["apiType"];
			baseUrl: string | null;
			apiKey: string | null;
		},
	): Promise<Envelope<Provider>>;
	deleteProvider(name: string): Promise<void>;
	listModels(): Promise<Envelope<Array<Model>>>;
	createModel(
		id: string,
		body: {
			provider: string;
			model: string;
			contextWindow: number | null;
			toolUse: boolean;
			streaming: boolean;
			metadata: Record<string, unknown> | null;
		},
	): Promise<Envelope<Model>>;
	deleteModel(id: string): Promise<void>;
	listSessions(): Promise<Envelope<Array<SessionInfo>>>;
	createSession(body: CreateSessionBody): Promise<Envelope<SessionInfo>>;
	deleteSession(id: string): Promise<void>;
	submitMessage(
		id: string,
		body: {
			content: string;
			env: Record<string, string> | null;
			model: CreateSessionBody["model"];
		},
	): Promise<Envelope<{ sessionId: string; messageId: string }>>;
	stopSession(id: string): Promise<Envelope<SessionInfo>>;
	streamEvents(
		id: string,
		onEvent: (event: string, data: string) => void,
	): Promise<void>;
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

	return {
		async getRoot() {
			const { json } = await requestJson<HostRootValue>("GET", "/", null);
			return json;
		},
		async listPrototypes() {
			const { json } = await requestJson<Array<PrototypeListItem>>(
				"GET",
				"/prototypes",
				null,
			);
			return json;
		},
		async createPrototype(name, body) {
			const { json } = await requestJson<PrototypeDetail>(
				"POST",
				`/prototypes/${encodeURIComponent(name)}`,
				{ name, ...body },
			);
			return json;
		},
		async deletePrototype(name) {
			const response = await fetch(
				`${baseUrl}/prototypes/${encodeURIComponent(name)}`,
				{ method: "DELETE" },
			);
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
		},
		async listProviders() {
			const { json } = await requestJson<Array<Provider>>(
				"GET",
				"/providers",
				null,
			);
			return json;
		},
		async createProvider(name, body) {
			const { json } = await requestJson<Provider>(
				"POST",
				`/providers/${encodeURIComponent(name)}`,
				body,
			);
			return json;
		},
		async deleteProvider(name) {
			const response = await fetch(
				`${baseUrl}/providers/${encodeURIComponent(name)}`,
				{ method: "DELETE" },
			);
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
		},
		async listModels() {
			const { json } = await requestJson<Array<Model>>("GET", "/models", null);
			return json;
		},
		async createModel(id, body) {
			const { json } = await requestJson<Model>(
				"POST",
				`/models/${encodeURIComponent(id)}`,
				body,
			);
			return json;
		},
		async deleteModel(id) {
			const response = await fetch(
				`${baseUrl}/models/${encodeURIComponent(id)}`,
				{ method: "DELETE" },
			);
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
		},
		async listSessions() {
			const { json } = await requestJson<Array<SessionInfo>>(
				"GET",
				"/sessions",
				null,
			);
			return json;
		},
		async createSession(body) {
			const { json } = await requestJson<SessionInfo>(
				"POST",
				"/sessions",
				body,
			);
			return json;
		},
		async deleteSession(id) {
			const response = await fetch(
				`${baseUrl}/sessions/${encodeURIComponent(id)}`,
				{
					method: "DELETE",
				},
			);
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
		},
		async submitMessage(id, body) {
			const { json } = await requestJson<{
				sessionId: string;
				messageId: string;
			}>("POST", `/sessions/${encodeURIComponent(id)}/messages`, body);
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
