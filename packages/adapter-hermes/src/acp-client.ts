import { spawn } from "node:child_process";
import type {
	AcpClient,
	AcpClientOptions,
	AcpInitializeResult,
	AcpNewSessionResult,
	AcpProcess,
	AcpPromptResult,
	AcpResumeSessionResult,
	AcpSessionUpdate,
	AcpSpawnFn,
} from "./types.js";

const CLIENT_VERSION = "0.1.0";
const CLIENT_NAME = "sumeru-adapter";

export const defaultAcpSpawn: AcpSpawnFn = ({ command, args, cwd }) => {
	const child = spawn(command, args, {
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
		cwd,
		env: process.env,
		shell: false,
	});
	if (child.stdin === null || child.stdout === null) {
		throw new Error("ACP process missing stdin or stdout");
	}
	return {
		stdin: child.stdin,
		stdout: child.stdout,
		kill: (signal) => {
			child.kill(signal);
		},
		on: (event, listener) => {
			child.on(event, listener);
		},
	} satisfies AcpProcess;
};

export function createAcpClient(options: AcpClientOptions): AcpClient {
	const spawnProcess = options.spawnProcess ?? defaultAcpSpawn;
	const clientInfo = options.clientInfo ?? {
		name: CLIENT_NAME,
		version: CLIENT_VERSION,
	};

	let process: AcpProcess | null = null;
	let nextRequestId = 0;
	let lineBuffer = "";
	let notificationListener:
		| ((update: AcpSessionUpdate, sessionId: string) => void)
		| null = null;

	const pendingRequests = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (err: Error) => void;
		}
	>();

	function ensureProcess(): AcpProcess {
		if (process === null) {
			process = spawnProcess({
				command: options.command,
				args: options.args,
				cwd: options.cwd,
			});
			process.stdout.setEncoding("utf8");
			process.stdout.on("data", onStdoutData);
			process.on("error", (err) => {
				rejectAllPending(err instanceof Error ? err : new Error(String(err)));
			});
			process.on("close", () => {
				rejectAllPending(new Error("ACP process closed unexpectedly"));
			});
		}
		return process;
	}

	function rejectAllPending(err: Error): void {
		for (const pending of pendingRequests.values()) {
			pending.reject(err);
		}
		pendingRequests.clear();
	}

	function onStdoutData(chunk: string | Buffer): void {
		lineBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		let newlineIdx = lineBuffer.indexOf("\n");
		while (newlineIdx >= 0) {
			const line = lineBuffer.slice(0, newlineIdx).trim();
			lineBuffer = lineBuffer.slice(newlineIdx + 1);
			if (line.length > 0) {
				dispatchLine(line);
			}
			newlineIdx = lineBuffer.indexOf("\n");
		}
	}

	function dispatchLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return;
		}
		if (!isRecord(parsed)) return;

		if (typeof parsed.id === "number") {
			handleResponse(parsed);
			return;
		}

		if (
			typeof parsed.method === "string" &&
			parsed.method === "session/update"
		) {
			handleNotification(parsed);
		}
	}

	function handleResponse(message: Record<string, unknown>): void {
		const id = message.id;
		if (typeof id !== "number") return;
		const pending = pendingRequests.get(id);
		if (pending === undefined) return;
		pendingRequests.delete(id);
		const error = message.error;
		if (isRecord(error) && typeof error.code === "number") {
			const errorMessage =
				typeof error.message === "string" ? error.message : "unknown error";
			pending.reject(new Error(`ACP error ${error.code}: ${errorMessage}`));
			return;
		}
		pending.resolve(message.result ?? null);
	}

	function handleNotification(message: Record<string, unknown>): void {
		if (notificationListener === null) return;
		const params = message.params;
		if (!isRecord(params)) return;
		const sessionId = params.sessionId;
		const update = params.update;
		if (typeof sessionId !== "string" || !isRecord(update)) return;
		const mapped = parseSessionUpdate(update);
		if (mapped === null) return;
		notificationListener(mapped, sessionId);
	}

	function writeRequest(
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		const proc = ensureProcess();
		const id = nextRequestId++;
		const payload = { jsonrpc: "2.0", id, method, params };
		return new Promise((resolve, reject) => {
			pendingRequests.set(id, { resolve, reject });
			proc.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
				if (err !== undefined && err !== null) {
					pendingRequests.delete(id);
					reject(err);
				}
			});
		});
	}

	return {
		async initialize(): Promise<AcpInitializeResult> {
			const result = await writeRequest("initialize", {
				protocolVersion: 1,
				clientCapabilities: {},
				clientInfo,
			});
			if (!isRecord(result)) {
				throw new Error("ACP initialize returned invalid result");
			}
			const capabilities = result.capabilities;
			return {
				capabilities: isRecord(capabilities) ? capabilities : {},
			};
		},

		async newSession(cwd: string): Promise<AcpNewSessionResult> {
			const result = await writeRequest("session/new", { cwd, mcpServers: [] });
			return parseSessionIdResult(result, "session/new");
		},

		async resumeSession(sessionId: string): Promise<AcpResumeSessionResult> {
			const result = await writeRequest("session/resume", { sessionId });
			return parseSessionIdResult(result, "session/resume");
		},

		async setMode(sessionId: string, modeId: string): Promise<void> {
			await writeRequest("session/set_mode", { sessionId, modeId });
		},

		async prompt(
			sessionId: string,
			content: string,
			onUpdate: (update: AcpSessionUpdate) => void,
		): Promise<AcpPromptResult> {
			notificationListener = (update, updateSessionId) => {
				if (updateSessionId === sessionId) {
					onUpdate(update);
				}
			};
			try {
				const result = await writeRequest("session/prompt", {
					sessionId,
					prompt: [{ type: "text", text: content }],
				});
				if (!isRecord(result)) {
					return {};
				}
				return result;
			} finally {
				notificationListener = null;
			}
		},

		async close(): Promise<void> {
			if (process === null) return;
			process.kill("SIGTERM");
			process = null;
			rejectAllPending(new Error("ACP client closed"));
		},
	};
}

function parseSessionIdResult(
	result: unknown,
	method: string,
): { sessionId: string } {
	if (!isRecord(result) || typeof result.sessionId !== "string") {
		throw new Error(`ACP ${method} returned invalid sessionId`);
	}
	return { sessionId: result.sessionId };
}

function parseSessionUpdate(
	update: Record<string, unknown>,
): AcpSessionUpdate | null {
	const kind = update.sessionUpdate;
	if (kind === "agent_message_chunk") {
		const content = update.content;
		if (!isRecord(content) || content.type !== "text") return null;
		const text = content.text;
		if (typeof text !== "string") return null;
		return {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		};
	}
	if (kind === "tool_call") {
		// Hermes ACP uses snake_case `tool_call_id` and puts the tool name in
		// the `title` field (e.g. "terminal: echo hi") rather than a `name` key.
		const toolCallId =
			typeof update.tool_call_id === "string"
				? update.tool_call_id
				: typeof update.toolCallId === "string"
					? update.toolCallId
					: null;
		const rawName =
			typeof update.name === "string"
				? update.name
				: typeof update.title === "string"
					? update.title.split(":")[0].trim()
					: null;
		if (toolCallId === null || rawName === null) return null;
		const input = isRecord(update.input)
			? update.input
			: isRecord(update.raw_input)
				? update.raw_input
				: {};
		return {
			sessionUpdate: "tool_call",
			toolCallId,
			name: rawName,
			input,
		};
	}
	if (kind === "tool_result" || kind === "tool_call_update") {
		// Hermes ACP emits "tool_call_update" with status "completed" for tool
		// results.  The result text lives in content[0].content.text.
		const toolCallId =
			typeof update.tool_call_id === "string"
				? update.tool_call_id
				: typeof update.toolCallId === "string"
					? update.toolCallId
					: null;
		if (toolCallId === null) return null;
		const result = stringifyToolResult(update.result ?? update.content);
		return {
			sessionUpdate: "tool_result",
			toolCallId,
			result,
			durationMs:
				typeof update.durationMs === "number" ? update.durationMs : null,
		};
	}
	if (kind === "usage_update") {
		const inputTokens = update.input_tokens;
		const outputTokens = update.output_tokens;
		if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
			return null;
		}
		return {
			sessionUpdate: "usage_update",
			input_tokens: inputTokens,
			output_tokens: outputTokens,
		};
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Normalize an ACP tool_result payload to a plain string. ACP may report the
// result as a bare string, an array of `{ type: "text", text }` content blocks,
// or a structured object; collapse all of these to text for the tool turn.
function stringifyToolResult(raw: unknown): string {
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw)) {
		return raw.map((block) => stringifyToolResult(block)).join("");
	}
	if (isRecord(raw)) {
		if (typeof raw.text === "string") return raw.text;
		if (typeof raw.output === "string") return raw.output;
		return JSON.stringify(raw);
	}
	if (raw === null || raw === undefined) return "";
	return String(raw);
}
