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
} from "@sumeru/adapter-core";
import type { DoneValue, ToolCall, TurnValue } from "@sumeru/core";
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
			}
			return;
		}
		if (activeSessionId === null) {
			const result = await client.newSession(cwd);
			activeSessionId = result.sessionId;
			sessionId = result.sessionId;
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
		if (message.resumeNativeId !== null) {
			sessionId = message.resumeNativeId;
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

			const trailing = flushPendingToolCalls(state);
			if (trailing !== null) {
				yield trailing;
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

function mapUpdateToTurns(
	update: AcpSessionUpdate,
	state: AcpStreamState,
): Array<TurnValue> {
	if (update.sessionUpdate === "tool_call") {
		state.pendingToolCalls.push(mapToolCall(update));
		return [];
	}
	if (update.sessionUpdate === "usage_update") {
		state.usage = {
			input: update.input_tokens,
			output: update.output_tokens,
		};
		return [];
	}
	const toolCalls =
		state.pendingToolCalls.length > 0 ? [...state.pendingToolCalls] : null;
	state.pendingToolCalls = [];
	return [
		{
			index: state.nextIndex++,
			role: "assistant",
			content: update.content.text,
			timestamp: new Date().toISOString(),
			toolCalls,
			tokens: null,
		},
	];
}

function flushPendingToolCalls(state: AcpStreamState): TurnValue | null {
	if (state.pendingToolCalls.length === 0) return null;
	const toolCalls = [...state.pendingToolCalls];
	state.pendingToolCalls = [];
	return {
		index: state.nextIndex++,
		role: "assistant",
		content: "",
		timestamp: new Date().toISOString(),
		toolCalls,
		tokens: null,
	};
}

function mapToolCall(
	update: Extract<AcpSessionUpdate, { sessionUpdate: "tool_call" }>,
): ToolCall {
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
