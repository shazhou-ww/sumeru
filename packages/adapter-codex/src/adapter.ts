/**
 * Codex adapter (v2) — implements `AdapterImpl` from `@sumeru/adapter-core`
 * by shelling out to `codex exec <prompt> --json`.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	DoneValue,
	TurnValue,
} from "@sumeru/adapter-core";
import { defaultStreamingSpawn } from "./spawn.js";
import {
	doneValueFromResultLine,
	parseCodexJsonIncremental,
} from "./stream-parser.js";
import type {
	CodexAdapterOptions,
	SpawnExitInfo,
	SpawnStreamResult,
} from "./types.js";

const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_SEND_TIMEOUT_MS = 2 * 60 * 60_000;
const STDERR_TRUNCATE_LIMIT = 500;
const API_KEY_ERROR_MESSAGE =
	"codex API key error. Check your OPENAI_API_KEY configuration.";
const API_KEY_PATTERNS: readonly RegExp[] = [
	/invalid api key/i,
	/OPENAI_API_KEY/i,
	/authentication/i,
	/unauthorized/i,
	/api.?key/i,
];

type PersistedAdapterState = {
	sessionId: string | null;
	initConfig: AdapterInitConfig;
};

export function createCodexAdapter(
	options: Partial<CodexAdapterOptions> = {},
): AdapterImpl {
	const codexBin = options.codexBin ?? DEFAULT_CODEX_BIN;
	const defaultModel = options.model ?? null;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const streamingSpawnFn = options.streamingSpawnFn ?? defaultStreamingSpawn;
	const configuredHomeDir = options.homeDir ?? null;
	const dangerouslyBypassApprovals = options.dangerouslyBypassApprovals ?? true;
	const skipGitRepoCheck = options.skipGitRepoCheck ?? true;

	let initConfig: AdapterInitConfig | null = null;
	let sessionId: string | null = null;
	let nextTurnIndex = 0;
	let handleLock: Promise<void> = Promise.resolve();

	function resolveHomeDir(): string {
		return configuredHomeDir ?? process.env.HOME ?? process.cwd();
	}

	function statePath(): string {
		return join(resolveHomeDir(), ".codex-adapter", "session.json");
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

	function resolveModel(): string | null {
		if (initConfig === null) return defaultModel;
		const fromInit = initConfig.model.name;
		if (fromInit.length > 0 && fromInit !== "auto") return fromInit;
		return defaultModel;
	}

	async function writeInitArtifacts(
		config: AdapterInitConfig,
		baseDir: string,
	): Promise<void> {
		await writeFile(join(baseDir, "AGENTS.md"), config.instructions, "utf8");
		for (const skill of config.skills) {
			const skillDir = join(baseDir, ".codex", "skills", skill.name);
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), skill.content, "utf8");
		}
	}

	function resolveCwd(message: AdapterInboxMessage): string {
		if (message.project !== null && message.project.length > 0) {
			return message.project;
		}
		return resolveHomeDir();
	}

	function buildArgs(
		prompt: string,
		resumeId: string | null,
		model: string | null,
		spawnCwd: string,
	): Array<string> {
		const args: Array<string> = ["exec"];
		if (resumeId !== null) {
			args.push("resume", resumeId);
		}
		args.push(prompt, "--json");
		if (dangerouslyBypassApprovals) {
			args.push("--dangerously-bypass-approvals-and-sandbox");
		}
		if (skipGitRepoCheck) {
			args.push("--skip-git-repo-check");
		}
		if (resumeId === null) {
			args.push("-C", spawnCwd);
		}
		if (model !== null) {
			args.push("-m", model);
		}
		return args;
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		await writeInitArtifacts(config, resolveHomeDir());
		const existing = loadPersistedState();
		await persistState({
			sessionId: existing?.sessionId ?? null,
			initConfig: config,
		});
	}

	async function resume(): Promise<boolean> {
		const state = loadPersistedState();
		if (state === null) return false;
		initConfig = state.initConfig;
		sessionId = state.sessionId;
		await writeInitArtifacts(state.initConfig, resolveHomeDir());
		return true;
	}

	async function* handle(
		message: AdapterInboxMessage,
	): AsyncGenerator<TurnValue, DoneValue> {
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
	): AsyncGenerator<TurnValue, DoneValue> {
		const config = initConfig as AdapterInitConfig;
		const cwd = resolveCwd(message);
		if (cwd !== resolveHomeDir()) {
			await writeInitArtifacts(config, cwd);
		}

		const model = resolveModel();
		const args = buildArgs(message.content, sessionId, model, cwd);

		let streamResult: SpawnStreamResult;
		try {
			streamResult = streamingSpawnFn({
				command: codexBin,
				args,
				timeoutMs: sendTimeoutMs,
				cwd,
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`codex adapter failed to spawn '${codexBin}': ${detail}`);
		}

		let resultLine: Record<string, unknown> | null = null;

		try {
			for await (const event of parseCodexJsonIncremental(streamResult.lines)) {
				if (event.type === "meta") {
					if (event.sessionId !== sessionId) {
						sessionId = event.sessionId;
						await persistState({ sessionId, initConfig: config });
					}
				} else if (event.type === "turn") {
					const turn = event.turn;
					turn.index = nextTurnIndex++;
					yield turn;
				} else if (event.type === "result") {
					resultLine = event.resultLine;
				}
			}
		} catch (err) {
			throw err instanceof Error
				? err
				: new Error(`stream read error: ${String(err)}`);
		}

		let exitInfo: SpawnExitInfo;
		try {
			exitInfo = await streamResult.waitForExit();
		} catch (err) {
			throw err instanceof Error
				? err
				: new Error(`process exit error: ${String(err)}`);
		}

		if (exitInfo.timedOut) {
			throw new Error(`codex timed out after ${String(sendTimeoutMs)}ms`);
		}

		if (exitInfo.exitCode !== null && exitInfo.exitCode !== 0) {
			throw makeExitError(exitInfo, sessionId);
		}

		return doneValueFromResultLine(resultLine);
	}

	return { init, handle, getNativeId: () => sessionId, resume };
}

function makeExitError(
	exitInfo: SpawnExitInfo,
	nativeId: string | null,
): Error {
	const stderrTrimmed = exitInfo.stderr.trim();

	for (const pattern of API_KEY_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				exitInfo.exitCode === null ? "null" : String(exitInfo.exitCode);
			return new Error(
				`codex exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`,
			);
		}
	}
	if (nativeId !== null && /not found|no such session/i.test(stderrTrimmed)) {
		return new Error(
			`codex session ${nativeId} not found: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`,
		);
	}

	const codeText = String(exitInfo.exitCode);
	const snippet =
		stderrTrimmed === ""
			? ""
			: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
	return new Error(`codex exited with code ${codeText}${snippet}`);
}

function tail(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(s.length - n);
}
