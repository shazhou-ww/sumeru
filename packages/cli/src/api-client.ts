export type CommandAcceptedValue = {
	sessionId: string;
	commandId: string;
};

export type CommandResultValue =
	| { type: "exec"; stdout: string; stderr: string; exitCode: number }
	| { type: "model"; provider: string; model: string }
	| { type: "install-skill"; name: string }
	| { type: "reset" }
	| { type: "snapshot"; name: string; image: string };

export type SessionCommand =
	| {
			type: "chat";
			content: string;
			messageId: string | null;
			env: Record<string, string> | null;
			model: string | null;
	  }
	| { type: "exec"; command: string }
	| { type: "model"; provider: string; model: string }
	| { type: "reset"; persona: string | null }
	| { type: "snapshot"; name: string };

export type Envelope<T> = {
	type: string;
	value: T;
};

export type ApiClient = {
	baseUrl: string;
	get<T>(path: string): Promise<Envelope<T>>;
	post<T>(
		path: string,
		body: unknown,
	): Promise<{ status: number; envelope: Envelope<T> }>;
	delete(path: string): Promise<void>;
	postCommand(
		sessionId: string,
		command: SessionCommand,
	): Promise<
		| { mode: "async"; value: CommandAcceptedValue }
		| { mode: "sync"; value: CommandResultValue }
	>;
	streamEvents(
		sessionId: string,
		onEvent: (event: string, data: string) => void,
	): Promise<void>;
};

export class ApiClientError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "ApiClientError";
		this.status = status;
		this.code = code;
	}
}

export function resolveApiBaseUrl(flags?: {
	host?: string;
	port?: string;
}): string {
	const fromEnv = process.env.SUMERU_URL;
	if (fromEnv !== undefined && fromEnv.length > 0) {
		return fromEnv.replace(/\/$/, "");
	}
	const host = flags?.host ?? process.env.SUMERU_HOST ?? "127.0.0.1";
	const portRaw = flags?.port ?? process.env.SUMERU_PORT ?? "7900";
	return `http://${host}:${String(portRaw)}`;
}

export function createApiClient(baseUrl: string): ApiClient {
	const normalized = baseUrl.replace(/\/$/, "");

	async function requestJson<T>(
		method: string,
		path: string,
		body: unknown | null,
	): Promise<{ status: number; envelope: Envelope<T> }> {
		const response = await fetch(`${normalized}${path}`, {
			method,
			headers:
				body === null ? undefined : { "Content-Type": "application/json" },
			body: body === null ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		if (text.length === 0) {
			throw new ApiClientError(
				response.status,
				"empty_response",
				"Empty response body",
			);
		}
		let envelope: Envelope<T>;
		try {
			envelope = JSON.parse(text) as Envelope<T>;
		} catch {
			throw new ApiClientError(
				response.status,
				"invalid_json",
				`Invalid JSON response (${String(response.status)})`,
			);
		}
		if (response.status >= 400) {
			const errValue = envelope.value as { error?: string; message?: string };
			throw new ApiClientError(
				response.status,
				errValue.error ?? "request_failed",
				errValue.message ?? `HTTP ${String(response.status)}`,
			);
		}
		return { status: response.status, envelope };
	}

	return {
		baseUrl: normalized,

		async get<T>(path: string): Promise<Envelope<T>> {
			const { envelope } = await requestJson<T>("GET", path, null);
			return envelope;
		},

		async post<T>(path: string, body: unknown) {
			return requestJson<T>("POST", path, body);
		},

		async delete(path: string): Promise<void> {
			const response = await fetch(`${normalized}${path}`, {
				method: "DELETE",
			});
			if (response.status === 204) return;
			const text = await response.text();
			if (text.length === 0) {
				throw new ApiClientError(
					response.status,
					"request_failed",
					`HTTP ${String(response.status)}`,
				);
			}
			const envelope = JSON.parse(text) as Envelope<{
				error: string;
				message: string;
			}>;
			throw new ApiClientError(
				response.status,
				envelope.value.error,
				envelope.value.message,
			);
		},

		async postCommand(sessionId, command) {
			const { status, envelope } = await requestJson<
				CommandAcceptedValue | CommandResultValue
			>("POST", `/sessions/${encodeURIComponent(sessionId)}/commands`, command);
			if (status === 202) {
				return {
					mode: "async",
					value: envelope.value as CommandAcceptedValue,
				};
			}
			return {
				mode: "sync",
				value: envelope.value as CommandResultValue,
			};
		},

		async streamEvents(sessionId, onEvent) {
			const response = await fetch(
				`${normalized}/sessions/${encodeURIComponent(sessionId)}/events`,
				{ headers: { Accept: "text/event-stream" } },
			);
			if (!response.ok) {
				const text = await response.text();
				if (text.length > 0) {
					const envelope = JSON.parse(text) as Envelope<{
						error: string;
						message: string;
					}>;
					throw new ApiClientError(
						response.status,
						envelope.value.error,
						envelope.value.message,
					);
				}
				throw new ApiClientError(
					response.status,
					"request_failed",
					`HTTP ${String(response.status)}`,
				);
			}
			const body = response.body;
			if (body === null) {
				throw new ApiClientError(500, "no_body", "SSE response has no body");
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
