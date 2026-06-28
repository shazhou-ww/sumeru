import { mkdtempSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createAcpClient } from "../src/acp-client.js";
import { createHermesAdapter } from "../src/adapter.js";
import type {
	AcpClient,
	AcpClientFactory,
	AcpProcess,
	AcpSessionUpdate,
} from "../src/types.js";

const INIT_CONFIG: AdapterInitConfig = {
	instructions: "You are the master agent.",
	skills: [{ name: "demo", content: "demo skill body" }],
	model: {
		provider: "anthropic",
		name: "claude-sonnet-4",
		apiKeyEnv: "ANTHROPIC_API_KEY",
		contextWindow: 200_000,
	},
};

type MockServerOptions = {
	sessionId: string;
	onPrompt: (content: string, emit: (update: AcpSessionUpdate) => void) => void;
};

function createMockAcpProcess(options: MockServerOptions): AcpProcess {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let buffer = "";

	stdin.on("data", (chunk) => {
		buffer += chunk.toString();
		let newlineIdx = buffer.indexOf("\n");
		while (newlineIdx >= 0) {
			const line = buffer.slice(0, newlineIdx).trim();
			buffer = buffer.slice(newlineIdx + 1);
			if (line.length > 0) {
				handleRequest(line);
			}
			newlineIdx = buffer.indexOf("\n");
		}
	});

	function writeResponse(id: number, result: Record<string, unknown>): void {
		stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
	}

	function writeNotification(update: AcpSessionUpdate): void {
		stdout.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				method: "session/update",
				params: { sessionId: options.sessionId, update },
			})}\n`,
		);
	}

	function handleRequest(line: string): void {
		const parsed = JSON.parse(line) as {
			id: number;
			method: string;
			params: Record<string, unknown>;
		};
		if (parsed.method === "initialize") {
			writeResponse(parsed.id, { capabilities: {} });
			return;
		}
		if (parsed.method === "session/new") {
			writeResponse(parsed.id, { sessionId: options.sessionId });
			return;
		}
		if (parsed.method === "session/resume") {
			writeResponse(parsed.id, { sessionId: options.sessionId });
			return;
		}
		if (parsed.method === "session/set_mode") {
			writeResponse(parsed.id, {});
			return;
		}
		if (parsed.method === "session/prompt") {
			const promptBlocks = parsed.params.prompt;
			const text =
				Array.isArray(promptBlocks) &&
				promptBlocks[0] !== undefined &&
				typeof promptBlocks[0] === "object" &&
				promptBlocks[0] !== null &&
				"text" in promptBlocks[0] &&
				typeof promptBlocks[0].text === "string"
					? promptBlocks[0].text
					: "";
			options.onPrompt(text, writeNotification);
			writeResponse(parsed.id, { stopReason: "end_turn" });
		}
	}

	return {
		stdin,
		stdout,
		kill: () => {
			stdin.destroy();
			stdout.destroy();
		},
		on: () => {},
	};
}

function createRecordingAcpClientFactory(
	options: MockServerOptions,
): AcpClientFactory {
	const calls: Array<{ method: string; args: Array<unknown> }> = [];
	const factory: AcpClientFactory & {
		calls: Array<{ method: string; args: Array<unknown> }>;
	} = (createOptions) => {
		const client = createAcpClient({
			...createOptions,
			clientInfo: { name: "sumeru-adapter", version: "0.1.0" },
			spawnProcess: () => createMockAcpProcess(options),
		});
		return wrapClientWithCallLog(client, calls);
	};
	factory.calls = calls;
	return factory;
}

function wrapClientWithCallLog(
	client: AcpClient,
	calls: Array<{ method: string; args: Array<unknown> }>,
): AcpClient {
	return {
		async initialize() {
			calls.push({ method: "initialize", args: [] });
			return client.initialize();
		},
		async newSession(cwd: string) {
			calls.push({ method: "newSession", args: [cwd] });
			return client.newSession(cwd);
		},
		async resumeSession(sessionId: string) {
			calls.push({ method: "resumeSession", args: [sessionId] });
			return client.resumeSession(sessionId);
		},
		async setMode(sessionId: string, modeId: string) {
			calls.push({ method: "setMode", args: [sessionId, modeId] });
			return client.setMode(sessionId, modeId);
		},
		async prompt(sessionId, content, onUpdate) {
			calls.push({ method: "prompt", args: [sessionId, content] });
			return client.prompt(sessionId, content, onUpdate);
		},
		async close() {
			calls.push({ method: "close", args: [] });
			return client.close();
		},
	};
}

describe("@sumeru/adapter-hermes — adapter", () => {
	it("init writes SOUL.md and skills under the configured hermes dir", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-init-"));
		const adapter = createHermesAdapter({ profile: "test", hermesDir });
		await adapter.init(INIT_CONFIG);

		const soul = await readFile(join(hermesDir, "SOUL.md"), "utf-8");
		expect(soul).toBe(INIT_CONFIG.instructions);
		const skill = await readFile(
			join(hermesDir, "skills", "demo", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("demo skill body");
	});

	it("handle uses ACP prompt and yields streaming assistant turns", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-handle-"));
		await mkdir(hermesDir, { recursive: true });
		const nativeId = "20260627_120000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (content, emit) => {
				expect(content).toBe("ping");
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "hello from hermes" },
				});
				emit({
					sessionUpdate: "usage_update",
					input_tokens: 10,
					output_tokens: 5,
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_1",
			content: "ping",
			project: "/tmp/project",
		});
		const turns = [];
		let tokenUsage = null;
		while (true) {
			const step = await generator.next();
			if (step.done === true) {
				tokenUsage = step.value.tokenUsage;
				break;
			}
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(acpClientFactory.calls.map((call) => call.method)).toEqual([
			"initialize",
			"newSession",
			"setMode",
			"prompt",
		]);
		expect(acpClientFactory.calls[1]?.args[0]).toBe("/tmp/project");
		expect(turns).toHaveLength(1);
		expect(turns[0]?.content).toBe("hello from hermes");
		expect(turns[0]?.toolCalls).toBeNull();
		expect(tokenUsage).toEqual({ input: 10, output: 5 });
		expect(adapter.getNativeId?.()).toBe(nativeId);
	});

	it("reuses the long-lived ACP client across subsequent handle calls", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-reuse-"));
		const nativeId = "20260627_130000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "ok" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		for (let i = 0; i < 2; i += 1) {
			const generator = adapter.handle({
				messageId: `msg_${i}`,
				content: `ping-${i}`,
				project: null,
			});
			while (true) {
				const step = await generator.next();
				if (step.done === true) break;
			}
		}

		expect(acpClientFactory.calls.map((call) => call.method)).toEqual([
			"initialize",
			"newSession",
			"setMode",
			"prompt",
			"prompt",
		]);
	});

	it("accumulates tool_call updates and yields them with the next message chunk", async () => {
		const hermesDir = mkdtempSync(join(tmpdir(), "hermes-tools-"));
		const nativeId = "20260627_150000_abcd12";
		const acpClientFactory = createRecordingAcpClientFactory({
			sessionId: nativeId,
			onPrompt: (_content, emit) => {
				emit({
					sessionUpdate: "tool_call",
					toolCallId: "tc_1",
					name: "terminal",
					input: { command: "ls" },
				});
				emit({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "listed files" },
				});
			},
		});
		const adapter = createHermesAdapter({
			profile: "test",
			hermesDir,
			acpClientFactory,
		});
		await adapter.init(INIT_CONFIG);

		const generator = adapter.handle({
			messageId: "msg_tools",
			content: "list files",
			project: null,
		});
		const turns = [];
		while (true) {
			const step = await generator.next();
			if (step.done === true) break;
			if (
				typeof step.value === "object" &&
				step.value !== null &&
				"type" in step.value
			) {
				continue;
			}
			turns.push(step.value);
		}

		expect(turns).toHaveLength(1);
		expect(turns[0]?.toolCalls).toEqual([
			{
				tool: "terminal",
				input: { command: "ls" },
				output: null,
				durationMs: null,
				exitCode: null,
			},
		]);
	});
});

describe("@sumeru/adapter-hermes — acp-client", () => {
	it("dispatches JSON-RPC responses and session_update notifications", async () => {
		const sessionId = "sess_mock_1";
		const client = createAcpClient({
			command: "hermes",
			args: ["acp", "--accept-hooks"],
			cwd: process.cwd(),
			clientInfo: { name: "test-client", version: "0.0.1" },
			spawnProcess: () =>
				createMockAcpProcess({
					sessionId,
					onPrompt: (_content, emit) => {
						emit({
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "streamed" },
						});
					},
				}),
		});

		await client.initialize();
		const created = await client.newSession(process.cwd());
		expect(created.sessionId).toBe(sessionId);

		const updates: Array<AcpSessionUpdate> = [];
		const result = await client.prompt(sessionId, "hello", (update) => {
			updates.push(update);
		});
		expect(result).toEqual({ stopReason: "end_turn" });
		expect(updates).toEqual([
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "streamed" },
			},
		]);
	});
});
