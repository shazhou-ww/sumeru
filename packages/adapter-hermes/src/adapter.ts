/**
 * Hermes adapter (v2) — implements `AdapterImpl` from `@sumeru/adapter-core`
 * via Hermes ACP (`hermes acp --accept-hooks`) JSON-RPC over stdin/stdout.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
const ACP_INIT_TIMEOUT_MS = 30_000;
const ACP_ARGS = ["acp", "--accept-hooks"] as const;

type PersistedAdapterState = {
	sessionId: string | null;
	initConfig: AdapterInitConfig;
};

export function createHermesAdapter(
	options: Partial<HermesAdapterOptions> = {},
): AdapterImpl {
	const _profile = options.profile ?? "default";
	const hermesBin = options.hermesBin ?? DEFAULT_HERMES_BIN;
	const configuredHermesDir = options.hermesDir ?? null;
	const configuredHomeDir = options.homeDir ?? null;
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

	function resolveHomeDir(): string {
		return configuredHomeDir ?? homedir();
	}

	function statePath(): string {
		return join(resolveHomeDir(), ".hermes-adapter", "session.json");
	}

	function loadPersistedState(): PersistedAdapterState | null {
		const path = statePath();
		if (!existsSync(path)) return null;
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as PersistedAdapterState;
		} catch {
			return null;
		}
	}

	async function persistState(state: PersistedAdapterState): Promise<void> {
		const path = statePath();
		mkdirSync(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(state), "utf-8");
	}

	async function persistCurrentState(): Promise<void> {
		if (initConfig === null) return;
		await persistState({ sessionId, initConfig });
	}

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
		// Only write config.yaml if it doesn't already exist.
		// control-frame model/reset commands manage this file when present;
		// adapter should not overwrite their configuration.
		const configPath = join(hermesDir, "config.yaml");
		try {
			await access(configPath);
			// config.yaml exists (written by control frames) — skip
		} catch {
			// config.yaml missing — write initial config from init frame
			await writeFile(configPath, buildHermesConfig(config.model), "utf8");
		}
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		await writeInitArtifacts(config);
		await persistState({ sessionId: null, initConfig: config });
	}

	async function resume(): Promise<boolean> {
		const state = loadPersistedState();
		if (state === null) return false;
		initConfig = state.initConfig;
		sessionId = state.sessionId;
		await writeInitArtifacts(state.initConfig);
		return true;
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
		await withTimeout(
			acpClient.initialize(),
			ACP_INIT_TIMEOUT_MS,
			"ACP initialize timed out",
		);
		return acpClient;
	}

	async function ensureSession(
		client: AcpClient,
		cwd: string,
		targetSessionId: string | null,
	): Promise<void> {
		if (targetSessionId !== null) {
			if (activeSessionId !== targetSessionId) {
				await withTimeout(
					client.resumeSession(targetSessionId),
					ACP_INIT_TIMEOUT_MS,
					"ACP session/resume timed out",
				);
				activeSessionId = targetSessionId;
				sessionId = targetSessionId;
				await client.setMode(targetSessionId, "dont_ask");
				await persistCurrentState();
			}
			return;
		}
		if (activeSessionId === null) {
			const result = await withTimeout(
				client.newSession(cwd),
				ACP_INIT_TIMEOUT_MS,
				"ACP session/new timed out",
			);
			activeSessionId = result.sessionId;
			sessionId = result.sessionId;
			await client.setMode(result.sessionId, "dont_ask");
			await persistCurrentState();
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
			pendingText: "",
			toolNamesById: new Map(),
			usage: null,
			pendingUsage: null,
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
		resume,
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
		// Hermes custom_providers use base_url (with /v1 suffix for chat_completions)
		// and api_mode instead of our protocol-level endpoint / apiType.
		let baseUrl = custom.endpoint;
		// Validate endpoint is an absolute URL — relative paths like "/v1" are
		// unusable by hermes and cause silent ACP init failures (#242).
		if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
			throw new Error(
				`Custom provider "${custom.name}" has invalid endpoint "${baseUrl}" (must be an absolute URL with http:// or https://)`,
			);
		}
		if (!baseUrl.endsWith("/v1") && !baseUrl.endsWith("/v1/")) {
			baseUrl = `${baseUrl.replace(/\/$/, "")}/v1`;
		}
		lines.push("custom_providers:");
		lines.push(`  - name: ${yamlScalar(custom.name)}`);
		lines.push(`    base_url: ${yamlScalar(baseUrl)}`);
		lines.push(`    api_mode: chat_completions`);
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
		// Record the tool name so a later tool_result (which carries only the id)
		// can be surfaced with the correct name (#182).
		state.toolNamesById.set(update.toolCallId, update.name);
		const toolCall = mapToolCall(update);
		// Flush accumulated text bound WITH the tool call on the same assistant
		// frame — not separately with toolCalls: null (#182 fix).
		const results: Array<TurnValue> = [];
		results.push({
			index: state.nextIndex++,
			role: "assistant",
			content: state.pendingText,
			timestamp: new Date().toISOString(),
			toolCalls: [toolCall],
			tokens: takePendingUsage(state),
			durationMs: null,
		});
		state.pendingText = "";
		return results;
	}
	if (update.sessionUpdate === "tool_result") {
		// Emit an independent role:"tool" turn for progressive streaming (#182).
		const name = state.toolNamesById.get(update.toolCallId) ?? "unknown";
		const results: Array<TurnValue> = [];
		results.push({
			index: state.nextIndex++,
			role: "tool",
			name,
			callId: update.toolCallId,
			result: update.result,
			durationMs: update.durationMs,
			timestamp: new Date().toISOString(),
		});
		return results;
	}
	if (update.sessionUpdate === "usage_update") {
		const usage = {
			input: update.input_tokens,
			output: update.output_tokens,
			cached: 0,
		};
		// `usage` is the cumulative snapshot surfaced on the `done` frame;
		// `pendingUsage` is attributed to the next flushed turn (#178).
		state.usage = usage;
		state.pendingUsage = { ...usage };
		return [];
	}
	// agent_message_chunk — accumulate text, don't yield yet
	state.pendingText += update.content.text;
	return [];
}

// Return the usage reported since the last flush and clear it, so the same
// usage is never attributed to more than one turn (#178).
function takePendingUsage(
	state: AcpStreamState,
): { input: number; output: number; cached: number } | null {
	const pending = state.pendingUsage;
	state.pendingUsage = null;
	return pending;
}

function flushPending(state: AcpStreamState): Array<TurnValue> {
	const results: Array<TurnValue> = [];
	if (state.pendingText.length > 0) {
		results.push({
			index: state.nextIndex++,
			role: "assistant",
			content: state.pendingText,
			timestamp: new Date().toISOString(),
			toolCalls: null,
			tokens: takePendingUsage(state),
			durationMs: null,
		});
		state.pendingText = "";
	}
	return results;
}

function mapToolCall(
	update: Extract<AcpSessionUpdate, { sessionUpdate: "tool_call" }>,
): WireToolCall {
	return {
		id: update.toolCallId,
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

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(message));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}
