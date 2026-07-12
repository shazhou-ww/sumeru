/**
 * Cursor Agent adapter — implements `AdapterImpl` from `@sumeru/adapter-core`
 * by shelling out to `cursor-agent -p … --print --output-format stream-json
 * --trust --force --workspace <cwd>` and parsing the resulting NDJSON stream
 * into `TurnValue` items.
 *
 * cursor-agent does NOT expose a stable on-disk session DB; the adapter
 * therefore relies on cursor-agent's `--resume <sessionId>` flag for
 * continuity and exposes the native session id via `getNativeId()`.
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
	parseStreamJsonIncremental,
} from "./stream-parser.js";
import type {
	CursorAgentOptions,
	SpawnExitInfo,
	SpawnStreamResult,
} from "./types.js";

const DEFAULT_CURSOR_AGENT_BIN = "cursor-agent";
const DEFAULT_SEND_TIMEOUT_MS = 10 * 60_000;
const STDERR_TRUNCATE_LIMIT = 500;
const API_KEY_ERROR_MESSAGE =
	"cursor-agent API key error. Check your CURSOR_API_KEY configuration.";
const TRUST_ERROR_MESSAGE =
	"cursor-agent requires --trust for headless operation.";
const API_KEY_PATTERNS: readonly RegExp[] = [
	/CURSOR_API_KEY/i,
	/authentication/i,
	/unauthorized/i,
	/api.?key/i,
];
const TRUST_PATTERNS: readonly RegExp[] = [
	/trust/i,
	/untrusted/i,
	/workspace not trusted/i,
];

type PersistedAdapterState = {
	sessionId: string | null;
	initConfig: AdapterInitConfig;
};

export function createCursorAgentAdapter(
	options: Partial<CursorAgentOptions> = {},
): AdapterImpl {
	const cursorAgentBin = options.cursorAgentBin ?? DEFAULT_CURSOR_AGENT_BIN;
	const defaultModel = options.model ?? null;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const streamingSpawnFn = options.streamingSpawnFn ?? defaultStreamingSpawn;
	const configuredHomeDir = options.homeDir ?? null;
	const permissionMode = options.permissionMode ?? "force";
	const sandbox = options.sandbox ?? null;

	let initConfig: AdapterInitConfig | null = null;
	let sessionId: string | null = null;
	let nextTurnIndex = 0;
	let handleLock: Promise<void> = Promise.resolve();

	function resolveHomeDir(): string {
		return configuredHomeDir ?? process.env.HOME ?? process.cwd();
	}

	function statePath(): string {
		return join(resolveHomeDir(), ".cursor-agent-adapter", "session.json");
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
		if (fromInit.length > 0) return fromInit;
		return defaultModel;
	}

	async function writeInitArtifacts(
		config: AdapterInitConfig,
		baseDir: string,
	): Promise<void> {
		await writeFile(join(baseDir, ".cursorrules"), config.instructions, "utf8");
		for (const skill of config.skills) {
			const skillDir = join(baseDir, ".cursor", "skills", skill.name);
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
	): string[] {
		const args = [
			"-p",
			prompt,
			"--print",
			"--output-format",
			"stream-json",
			"--trust",
		];
		// Permission mode flag
		if (permissionMode === "force") {
			args.push("--force");
		} else if (permissionMode === "yolo") {
			args.push("--yolo");
		}
		if (resumeId !== null) {
			args.push("--resume", resumeId);
		}
		if (model !== null) {
			args.push("--model", model);
		}
		if (sandbox !== null) {
			args.push("--sandbox", sandbox);
		}
		args.push("--workspace", spawnCwd);
		return args;
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		await writeInitArtifacts(config, resolveHomeDir());
		await persistState({ sessionId: null, initConfig: config });
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
				command: cursorAgentBin,
				args,
				timeoutMs: sendTimeoutMs,
				cwd,
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`cursor-agent adapter failed to spawn '${cursorAgentBin}': ${detail}`,
			);
		}

		let resultLine: Record<string, unknown> | null = null;

		try {
			for await (const event of parseStreamJsonIncremental(
				streamResult.lines,
			)) {
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
			throw new Error(
				`cursor-agent timed out after ${String(sendTimeoutMs)}ms`,
			);
		}

		if (exitInfo.exitCode !== null && exitInfo.exitCode !== 0) {
			throw makeExitError(exitInfo, sessionId);
		}

		if (sessionId === null && resultLine !== null) {
			const fromResult = resultLine.session_id;
			if (typeof fromResult === "string" && fromResult.length > 0) {
				sessionId = fromResult;
				await persistState({ sessionId, initConfig: config });
			}
		}

		return doneValueFromResultLine(resultLine);
	}

	return { init, handle, getNativeId: () => sessionId, resume };
}

function makeExitError(
	exitInfo: SpawnExitInfo,
	sessionId: string | null,
): Error {
	const stderrTrimmed = exitInfo.stderr.trim();

	// API key errors take precedence.
	for (const pattern of API_KEY_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				exitInfo.exitCode === null ? "null" : String(exitInfo.exitCode);
			return new Error(
				`cursor-agent exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`,
			);
		}
	}

	// Trust errors.
	for (const pattern of TRUST_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				exitInfo.exitCode === null ? "null" : String(exitInfo.exitCode);
			return new Error(
				`cursor-agent exited with code ${codeText}: ${TRUST_ERROR_MESSAGE}`,
			);
		}
	}

	// Session-not-found heuristic for resume failures.
	if (
		sessionId !== null &&
		/not found|no such session|session.*not.*exist/i.test(stderrTrimmed)
	) {
		return new Error(
			`cursor-agent session ${sessionId} not found: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`,
		);
	}

	const codeText = String(exitInfo.exitCode);
	const snippet =
		stderrTrimmed === ""
			? ""
			: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
	return new Error(`cursor-agent exited with code ${codeText}${snippet}`);
}

function tail(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(s.length - n);
}
