/**
 * Claude Code adapter (v2) — implements `AdapterImpl` from `@sumeru/adapter-core`
 * by shelling out to `claude -p … --output-format stream-json --verbose`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
} from "@sumeru/adapter-core";
import type { DoneValue, TurnValue } from "@sumeru/adapter-core";
import { defaultStreamingSpawn } from "./spawn.js";
import {
	doneValueFromResultLine,
	parseStreamJsonIncremental,
} from "./stream-parser.js";
import type {
	ClaudeCodeOptions,
	SpawnExitInfo,
	SpawnStreamResult,
} from "./types.js";

const DEFAULT_CLAUDE_BIN = "claude";
const DEFAULT_MAX_TURNS = 90;
const DEFAULT_SEND_TIMEOUT_MS = 2 * 60 * 60_000;
const STDERR_TRUNCATE_LIMIT = 500;
const NOT_LOGGED_IN_MESSAGE =
	"claude code is not logged in. Run `claude login` first.";
const API_KEY_ERROR_MESSAGE =
	"claude code API key error. Check your API key configuration.";
const API_KEY_PATTERNS: readonly RegExp[] = [
	/invalid api key/i,
	/ANTHROPIC_API_KEY/i,
	/authentication/i,
	/unauthorized/i,
];

export function createClaudeCodeAdapter(
	options: Partial<ClaudeCodeOptions> = {},
): AdapterImpl {
	const claudeBin = options.claudeBin ?? DEFAULT_CLAUDE_BIN;
	const defaultModel = options.model ?? null;
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const streamingSpawnFn = options.streamingSpawnFn ?? defaultStreamingSpawn;
	const configuredHomeDir = options.homeDir ?? null;

	let initConfig: AdapterInitConfig | null = null;
	let sessionId: string | null = null;
	let nextTurnIndex = 0;
	let handleLock: Promise<void> = Promise.resolve();

	function resolveHomeDir(): string {
		return configuredHomeDir ?? process.env.HOME ?? process.cwd();
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
		await writeFile(join(baseDir, "CLAUDE.md"), config.instructions, "utf8");
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
	): string[] {
		const args = ["-p", prompt];
		if (resumeId !== null) {
			args.push("--resume", resumeId);
		}
		args.push(
			"--output-format",
			"stream-json",
			"--verbose",
			"--dangerously-skip-permissions",
			"--bare",
			"--max-turns",
			String(maxTurns),
		);
		if (model !== null) {
			args.push("--model", model);
		}
		return args;
	}

	async function init(config: AdapterInitConfig): Promise<void> {
		initConfig = config;
		await writeInitArtifacts(config, resolveHomeDir());
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
		const args = buildArgs(message.content, sessionId, model);

		let streamResult: SpawnStreamResult;
		try {
			streamResult = streamingSpawnFn({
				command: claudeBin,
				args,
				timeoutMs: sendTimeoutMs,
				cwd,
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`claude code adapter failed to spawn '${claudeBin}': ${detail}`,
			);
		}

		let resultLine: Record<string, unknown> | null = null;

		try {
			for await (const event of parseStreamJsonIncremental(
				streamResult.lines,
			)) {
				if (event.type === "meta") {
					sessionId = event.sessionId;
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
			throw new Error(`claude timed out after ${String(sendTimeoutMs)}ms`);
		}

		if (exitInfo.exitCode !== null && exitInfo.exitCode !== 0) {
			throw makeExitError(exitInfo, sessionId);
		}

		if (sessionId === null && resultLine !== null) {
			const fromResult = resultLine.session_id;
			if (typeof fromResult === "string" && fromResult.length > 0) {
				sessionId = fromResult;
			}
		}

		return doneValueFromResultLine(resultLine);
	}

	return { init, handle, getNativeId: () => sessionId };
}

function makeExitError(
	exitInfo: SpawnExitInfo,
	sessionId: string | null,
): Error {
	const stderrTrimmed = exitInfo.stderr.trim();

	if (/not logged in/i.test(stderrTrimmed)) {
		const codeText =
			exitInfo.exitCode === null ? "null" : String(exitInfo.exitCode);
		return new Error(
			`claude exited with code ${codeText}: ${NOT_LOGGED_IN_MESSAGE}`,
		);
	}
	for (const pattern of API_KEY_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				exitInfo.exitCode === null ? "null" : String(exitInfo.exitCode);
			return new Error(
				`claude exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`,
			);
		}
	}
	if (sessionId !== null && /not found|no such session/i.test(stderrTrimmed)) {
		return new Error(
			`claude code session ${sessionId} not found: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`,
		);
	}

	const codeText = String(exitInfo.exitCode);
	const snippet =
		stderrTrimmed === ""
			? ""
			: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
	return new Error(`claude exited with code ${codeText}${snippet}`);
}

function tail(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(s.length - n);
}
