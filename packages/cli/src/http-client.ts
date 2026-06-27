import type { InstanceInfo } from "@sumeru/core";

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
	master: string;
	prototypes: Array<string>;
	instances: Array<string>;
};

export type PrototypeListItem = {
	name: string;
	adapter: string;
};

export type HostClient = {
	getRoot(): Promise<Envelope<HostRootValue>>;
	listPrototypes(): Promise<Envelope<Array<PrototypeListItem>>>;
	listInstances(): Promise<Envelope<Array<InstanceInfo>>>;
	createInstance(
		prototype: string,
		projects: Array<string> | null,
	): Promise<Envelope<InstanceInfo>>;
	deleteInstance(id: string): Promise<void>;
	submitInbox(
		id: string,
		body: { messageId: string; content: string; project: string | null },
	): Promise<Envelope<{ instanceId: string; messageId: string }>>;
	resetInstance(id: string): Promise<void>;
	streamOutbox(
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
		async listInstances() {
			const { json } = await requestJson<Array<InstanceInfo>>(
				"GET",
				"/instances",
				null,
			);
			return json;
		},
		async createInstance(prototype, projects) {
			const { json } = await requestJson<InstanceInfo>("POST", "/instances", {
				prototype,
				projects,
			});
			return json;
		},
		async deleteInstance(id) {
			const response = await fetch(
				`${baseUrl}/instances/${encodeURIComponent(id)}`,
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
		async submitInbox(id, body) {
			const { json } = await requestJson<{
				instanceId: string;
				messageId: string;
			}>("POST", `/instances/${encodeURIComponent(id)}/inbox`, body);
			return json;
		},
		async resetInstance(id) {
			const response = await fetch(
				`${baseUrl}/instances/${encodeURIComponent(id)}/reset`,
				{ method: "POST" },
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
		async streamOutbox(id, onEvent) {
			const response = await fetch(
				`${baseUrl}/instances/${encodeURIComponent(id)}/outbox`,
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
