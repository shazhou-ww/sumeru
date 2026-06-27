/**
 * Hermes adapter (v2) — implements `AdapterImpl` from `@sumeru/adapter-core`
 * by shelling out to `hermes chat -q --pass-session-id --source sumeru`.
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
import type { DoneValue, TokenUsage, TurnValue } from "@sumeru/core";
import { readTurnsFromJsonl } from "./jsonl.js";
import { defaultSpawn } from "./spawn.js";
import type { HermesAdapterOptions, SpawnFn } from "./types.js";

const DEFAULT_HERMES_BIN = "hermes";
const DEFAULT_SOURCE_TAG = "sumeru";
const DEFAULT_SEND_TIMEOUT_MS = 2 * 60 * 60_000;
const SESSION_ID_RE = /^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/;
const SESSION_LINE_RE = /(?:^|\n)(?:Session:|session_id:)\s+(\S+)\s*$/m;

export function createHermesAdapter(
	options: Partial<HermesAdapterOptions> = {},
): AdapterImpl {
	const _profile = options.profile ?? "default";
	const hermesBin = options.hermesBin ?? DEFAULT_HERMES_BIN;
	const configuredHermesDir = options.hermesDir ?? null;
	const spawnFn: SpawnFn = options.spawnFn ?? defaultSpawn;
	const jsonlReader = options.jsonlReader ?? readTurnsFromJsonl;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;

	let initConfig: AdapterInitConfig | null = null;
	let sessionId: string | null = null;
	let nextTurnIndex = 0;
	let handleLock: Promise<void> = Promise.resolve();

	function resolveHermesDir(): string {
		if (configuredHermesDir !== null) return configuredHermesDir;
		return join(homedir(), ".hermes");
	}

	function resolveSkillsDir(): string {
		return join(resolveHermesDir(), "skills");
	}

	function resolveSessionsDir(): string {
		return join(resolveHermesDir(), "sessions");
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
		const resumeId = sessionId;
		const before =
			resumeId === null
				? []
				: ((await jsonlReader(resolveSessionsDir(), resumeId)) ?? []);
		const highWater =
			before.length === 0
				? -1
				: before.reduce(
						(max, turn) => (turn.index > max ? turn.index : max),
						-1,
					);

		const args = [
			"chat",
			"-q",
			"--pass-session-id",
			"--quiet",
			"--source",
			DEFAULT_SOURCE_TAG,
		];
		if (resumeId !== null) {
			args.push("--resume", resumeId);
		}

		let result: Awaited<ReturnType<SpawnFn>>;
		try {
			result = await spawnFn({
				command: hermesBin,
				args,
				stdin: message.content,
				timeoutMs: sendTimeoutMs,
				cwd: resolveCwd(message),
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`hermes adapter failed to spawn '${hermesBin}': ${detail}`,
			);
		}

		if (result.timedOut) {
			yield {
				type: "suspend",
				value: { reason: "timeout", elapsedMs: result.durationMs },
			};
			return { summary: null, tokenUsage: null };
		}
		if (result.exitCode !== 0) {
			throw makeExitError(
				result.stderr,
				result.stdout,
				result.exitCode,
				sessionId,
			);
		}

		const merged = `${result.stderr}\n${result.stdout}`;
		const match = merged.match(SESSION_LINE_RE);
		if (match !== null && match[1] !== undefined) {
			const parsedId = match[1];
			if (SESSION_ID_RE.test(parsedId)) {
				sessionId = parsedId;
			}
		}
		if (sessionId === null) {
			throw new Error(
				`failed to parse Hermes session id from stderr+stdout: ${tail(merged, 500)}`,
			);
		}

		const after = (await jsonlReader(resolveSessionsDir(), sessionId)) ?? [];
		const delta = after.filter((turn) => turn.index > highWater);
		const filtered = delta.filter((turn) => turn.role !== "system");
		for (const turn of filtered) {
			const mapped: TurnValue = { ...turn, index: nextTurnIndex++ };
			yield mapped;
		}

		return {
			summary: null,
			tokenUsage: aggregateTokens(filtered),
		};
	}

	return {
		init,
		handle,
		getNativeId: () => sessionId,
	};
}

function makeExitError(
	stderr: string,
	stdout: string,
	exitCode: number | null,
	sessionId: string | null,
): Error {
	const merged = `${stderr}\n${stdout}`.trim();
	const stderrLower = stderr.toLowerCase();
	if (
		sessionId !== null &&
		(stderrLower.includes("not found") ||
			stderrLower.includes("no such session"))
	) {
		return new Error(
			`hermes session ${sessionId} not found: ${tail(merged, 500)}`,
		);
	}
	const codeText = exitCode === null ? "null" : String(exitCode);
	return new Error(`hermes exited with code ${codeText}: ${tail(merged, 500)}`);
}

function tail(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return value.slice(value.length - limit);
}

function aggregateTokens(turns: Array<TurnValue>): TokenUsage | null {
	let any = false;
	let input = 0;
	let output = 0;
	for (const turn of turns) {
		if (turn.tokens === null) continue;
		any = true;
		input += turn.tokens.input;
		output += turn.tokens.output;
	}
	return any ? { input, output } : null;
}
