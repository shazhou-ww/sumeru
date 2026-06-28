import type { ToolCall } from "@sumeru/core";

export type HermesAdapterOptions = {
	profile: string;
	hermesBin: string | null;
	hermesDir: string | null;
	acpClientFactory: AcpClientFactory | null;
	sendTimeoutMs: number | null;
};

export type AcpClientFactory = (options: AcpClientCreateOptions) => AcpClient;

export type AcpClientCreateOptions = {
	command: string;
	args: Array<string>;
	cwd: string;
};

export type JsonRpcError = {
	code: number;
	message: string;
	data: unknown | null;
};

export type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number;
	result: unknown | null;
	error: JsonRpcError | null;
};

export type JsonRpcNotification = {
	jsonrpc: "2.0";
	method: string;
	params: Record<string, unknown>;
};

export type AcpContentBlock = {
	type: "text";
	text: string;
};

export type AcpSessionUpdate =
	| {
			sessionUpdate: "agent_message_chunk";
			content: AcpContentBlock;
	  }
	| {
			sessionUpdate: "tool_call";
			toolCallId: string;
			name: string;
			input: Record<string, unknown>;
	  }
	| {
			sessionUpdate: "usage_update";
			input_tokens: number;
			output_tokens: number;
	  };

export type AcpSessionUpdateParams = {
	sessionId: string;
	update: AcpSessionUpdate;
};

export type AcpNotification = JsonRpcNotification & {
	method: "session_update";
	params: AcpSessionUpdateParams;
};

export type AcpInitializeResult = {
	capabilities: Record<string, unknown>;
};

export type AcpNewSessionResult = {
	sessionId: string;
};

export type AcpResumeSessionResult = {
	sessionId: string;
};

export type AcpPromptResult = Record<string, unknown>;

export type AcpClient = {
	initialize(): Promise<AcpInitializeResult>;
	newSession(cwd: string): Promise<AcpNewSessionResult>;
	resumeSession(sessionId: string): Promise<AcpResumeSessionResult>;
	setMode(sessionId: string, modeId: string): Promise<void>;
	prompt(
		sessionId: string,
		content: string,
		onUpdate: (update: AcpSessionUpdate) => void,
	): Promise<AcpPromptResult>;
	close(): Promise<void>;
};

export type AcpProcess = {
	stdin: NodeJS.WritableStream;
	stdout: NodeJS.ReadableStream;
	kill: (signal?: NodeJS.Signals) => void;
	on: (
		event: "close" | "error",
		listener: (...args: Array<unknown>) => void,
	) => void;
};

export type AcpSpawnFn = (args: {
	command: string;
	args: Array<string>;
	cwd: string;
}) => AcpProcess;

export type AcpClientOptions = AcpClientCreateOptions & {
	clientInfo: { name: string; version: string };
	spawnProcess: AcpSpawnFn | null;
};

export type AcpStreamState = {
	pendingToolCalls: Array<ToolCall>;
	pendingText: string;
	usage: { input: number; output: number } | null;
	nextIndex: number;
};
