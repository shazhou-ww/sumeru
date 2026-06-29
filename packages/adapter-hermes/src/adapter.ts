/**
 * Hermes adapter (v2) — implements `AdapterImpl` from `@sumeru/adapter-core`
 * via Hermes ACP (`hermes acp --accept-hooks`) JSON-RPC over stdin/stdout.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	DoneValue,
	TurnValue,
	WireToolCall,
} from "@sumeru/adapter-core";
import type { CustomProvider, KnownProvider, ModelConfig } from "@sumeru/core";
import { createAcpClient } from "./acp-client.js";
import type {
	AcpClient,
	AcpSessionUpdate,
	AcpStreamState,
	HermesAdapterOptions,
} from "./types.js";

const DEFAULT_HERMES_BIN = "hermes";
const DEFAULT_SEND_TIMEOUT_MS = 2 * 60 * 60_000;
const ACP_ARGS = ["acp", "--accept-hooks"] as const;

export function createHermesAdapter(
	options: Partial<HermesAdapterOptions> = {},
): AdapterImpl {
	const _profile = options.profile ?? "default";
	const hermesBin = options.hermesBin ?? DEFAULT_HERMES_BIN;
	const configuredHermesDir = options.hermesDir ?? null;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;

	let initConfig: AdapterInitConfig | null = null;
	let sessionId: string | null = null;
	let activeSessionId: string | null = null;
	let acpClient: AcpClient | null = null;
	let acpCwd: string | null = null;
	let nextTurnIndex = 0;
	let handleLock: Promise<void> = Promise.resolve();

	const acpClientFactory =
		options.acpClientFactory ??
		((createOptions) =>
			createAcpClient({
				...createOptions,
				clientInfo: { name: "sumeru-adapter", version: "0.1.0" },
				spawnProcess: null,
			}));

	function resolveHermesDir(): string {
		if (configuredHermesDir !== null) return configuredHermesDir;
		return join(homedir(), ".hermes");
	}

	function resolveSkillsDir(): string {
		return join(resolveHermesDir(), "skills");
	}

	function resolveCwd(message: AdapterInboxMessage): string {
		if (message.project !== null && message.project.length > 0) {
			return message.project;
		}
		return process.cwd();
	}

	async function writeInitArtifacts(config: AdapterInitConfig): Promise<void> {
		const hermesDir = resolveHermesDir();
		await mkdir(hermesDir, { recursive: true });
		await writeFile(join(hermesDir, "SOUL.md"), config.instructions, "utf8");
		const skillsDir = resolveSkillsDir();
		for (const skill of config.skills) {
			const skillDir = join(skillsDir, skill.name);
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), skill.content, "utf8");
		}
		await writeFile(
			join(hermesDir, "config.yaml"),
			buildHermesConfig(config.model),
			"utf8",
		);
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		await writeInitArtifacts(config);
	}

	async function ensureAcpClient(cwd: string): Promise<AcpClient> {
		if (acpClient !== null) {
			return acpClient;
		}
		acpCwd = cwd;
		acpClient = acpClientFactory({
			command: hermesBin,
			args: [...ACP_ARGS],
			cwd,
		});
		await acpClient.initialize();
		return acpClient;
	}

	async function ensureSession(
		client: AcpClient,
		cwd: string,
		targetSessionId: string | null,
	): Promise<void> {
		if (targetSessionId !== null) {
			if (activeSessionId !== targetSessionId) {
				await client.resumeSession(targetSessionId);
				activeSessionId = targetSessionId;
				sessionId = targetSessionId;
				await client.setMode(targetSessionId, "dont_ask");
			}
			return;
		}
		if (activeSessionId === null) {
			const result = await client.newSession(cwd);
			activeSessionId = result.sessionId;
			sessionId = result.sessionId;
			await client.setMode(result.sessionId, "dont_ask");
		}
	}

	async function* handle(
		message: AdapterInboxMessage,
	): AsyncGenerator<AdapterHandleYield, DoneValue> {
		if (initConfig === null) {
			throw new Error("handle called before init");
		}
		if (typeof message.content !== "string" || message.content.length === 0) {
			throw new Error("handle: content must be a non-empty string");
		}

		const prev = handleLock;
		let release: () => void = () => {};
		handleLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prev;

		try {
			return yield* runHandle(message);
		} finally {
			release();
		}
	}

	async function* runHandle(
		message: AdapterInboxMessage,
	): AsyncGenerator<AdapterHandleYield, DoneValue> {
		const cwd = resolveCwd(message);
		if (acpCwd !== null && acpCwd !== cwd && acpClient !== null) {
			throw new Error(
				`hermes ACP client cwd mismatch: expected ${acpCwd}, got ${cwd}`,
			);
		}

		let client: AcpClient;
		try {
			client = await ensureAcpClient(cwd);
			await ensureSession(client, cwd, sessionId);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`hermes adapter failed to start ACP client '${hermesBin}': ${detail}`,
			);
		}

		if (sessionId === null) {
			throw new Error("hermes ACP session id is missing after session setup");
		}

		const state: AcpStreamState = {
			pendingToolCalls: [],
			pendingText: "",
			usage: null,
			nextIndex: nextTurnIndex,
		};
		const turnQueue: Array<TurnValue> = [];
		let wakeup: (() => void) | null = null;

		const onUpdate = (update: AcpSessionUpdate): void => {
			for (const turn of mapUpdateToTurns(update, state)) {
				turnQueue.push(turn);
			}
			if (wakeup !== null) {
				const resume = wakeup;
				wakeup = null;
				resume();
			}
		};

		const promptPromise = client.prompt(sessionId, message.content, onUpdate);
		const timeoutPromise = delay(sendTimeoutMs).then(() => "timeout" as const);

		while (true) {
			while (turnQueue.length > 0) {
				const turn = turnQueue.shift() as TurnValue;
				yield turn;
			}

			const raced = await Promise.race([
				promptPromise.then((result) => ({ kind: "done" as const, result })),
				new Promise<{ kind: "tick" }>((resolve) => {
					wakeup = () => resolve({ kind: "tick" });
				}),
				timeoutPromise.then((reason) => ({ kind: reason })),
			]);

			if (raced.kind === "timeout") {
				yield {
					type: "suspend",
					value: { reason: "timeout", elapsedMs: sendTimeoutMs },
				};
				return { summary: null, tokenUsage: null };
			}

			if (raced.kind === "tick") {
				continue;
			}

			while (turnQueue.length > 0) {
				const turn = turnQueue.shift() as TurnValue;
				yield turn;
			}

			const trailing = flushPending(state);
			for (const turn of trailing) {
				yield turn;
			}

			nextTurnIndex = state.nextIndex;
			return {
				summary: null,
				tokenUsage: state.usage,
			};
		}
	}

	return {
		init,
		handle,
		getNativeId: () => sessionId,
	};
}

function isCustomProvider(
	provider: KnownProvider | CustomProvider,
): provider is CustomProvider {
	return typeof provider === "object";
}

function yamlScalar(value: string): string {
	if (/[:#\n"'\\]|^\s|\s$/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}

function appendApiKey(
	lines: Array<string>,
	indent: string,
	apiKey: string | null,
): void {
	if (apiKey !== null) {
		lines.push(`${indent}api_key: ${yamlScalar(apiKey)}`);
	}
}

export function buildHermesConfig(model: ModelConfig): string {
	const lines: Array<string> = [];

	if (isCustomProvider(model.provider)) {
		const custom = model.provider;
		lines.push("custom_providers:");
		lines.push(`  - name: ${yamlScalar(custom.name)}`);
		lines.push(`    endpoint: ${yamlScalar(custom.endpoint)}`);
		lines.push(`    api_type: ${yamlScalar(custom.apiType)}`);
		appendApiKey(lines, "    ", model.apiKey);
		lines.push("model:");
		lines.push(`  provider: custom:${yamlScalar(custom.name)}`);
		lines.push(`  default: ${yamlScalar(model.name)}`);
		return `${lines.join("\n")}\n`;
	}

	const provider = model.provider;
	lines.push("model:");
	lines.push(`  provider: ${yamlScalar(provider)}`);
	lines.push(`  default: ${yamlScalar(model.name)}`);
	appendApiKey(lines, "  ", model.apiKey);
	return `${lines.join("\n")}\n`;
}

function mapUpdateToTurns(
	update: AcpSessionUpdate,
	state: AcpStreamState,
): Array<TurnValue> {
	if (update.sessionUpdate === "tool_call") {
		// Flush accumulated text before yielding tool call
		const results: Array<TurnValue> = [];
		if (state.pendingText.length > 0) {
			results.push({
				index: state.nextIndex++,
				role: "assistant",
				content: state.pendingText,
				timestamp: new Date().toISOString(),
				toolCalls: null,
				tokens: null,
			});
			state.pendingText = "";
		}
		state.pendingToolCalls.push(mapToolCall(update));
		return results;
	}
	if (update.sessionUpdate === "usage_update") {
		state.usage = {
			input: update.input_tokens,
			output: update.output_tokens,
			cached: 0,
		};
		return [];
	}
	// agent_message_chunk — accumulate text, don't yield yet
	state.pendingText += update.content.text;
	return [];
}

function flushPending(state: AcpStreamState): Array<TurnValue> {
	const results: Array<TurnValue> = [];
	if (state.pendingText.length > 0) {
		const toolCalls =
			state.pendingToolCalls.length > 0 ? [...state.pendingToolCalls] : null;
		state.pendingToolCalls = [];
		results.push({
			index: state.nextIndex++,
			role: "assistant",
			content: state.pendingText,
			timestamp: new Date().toISOString(),
			toolCalls,
			tokens: null,
		});
		state.pendingText = "";
	} else if (state.pendingToolCalls.length > 0) {
		const toolCalls = [...state.pendingToolCalls];
		state.pendingToolCalls = [];
		results.push({
			index: state.nextIndex++,
			role: "assistant",
			content: "",
			timestamp: new Date().toISOString(),
			toolCalls,
			tokens: null,
		});
	}
	return results;
}

function mapToolCall(
	update: Extract<AcpSessionUpdate, { sessionUpdate: "tool_call" }>,
): WireToolCall {
	return {
		tool: update.name,
		input: update.input,
		output: null,
		durationMs: null,
		exitCode: null,
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
