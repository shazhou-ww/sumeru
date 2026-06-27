/**
 * Codex adapter — implements the `Adapter` contract from `@sumeru/core`
 * by shelling out to `codex exec <prompt> --json
 * --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check`
 * for create/send and parsing the resulting JSONL stream into `Turn[]`.
 *
 * Codex supports session resume via `codex exec resume <id> <prompt>`.
 * The adapter caches parsed turns in an in-memory `Map<string, Turn[]>`
 * keyed by `nativeId` and is the sole authority on history for the
 * lifetime of the adapter instance.
 *
 * The factory:
 *   - createSession spawns `codex exec "ping" --json ...` and parses the
 *     JSONL stream for the session id. Accepts `SessionConfig` with
 *     `model` and `cwd` fields.
 *   - send is an async generator that spawns `codex exec resume <id>
 *     <prompt> --json ...`, parses the JSONL output, and yields each
 *     delta turn as `{ type: "turn", turn }` followed by
 *     `{ type: "done", durationMs, tokens }`. On error yields
 *     `{ type: "error", error }` instead of throwing.
 *   - close is a logical close — adds the nativeId to a per-instance Set;
 *     no Codex-side notification, no cache eviction.
 *   - getTurns returns a defensive copy of the in-memory cache.
 */

import type {
	Adapter,
	NativeSessionRef,
	SendEvent,
	SessionConfig,
	TokenUsage,
	Turn,
} from "@sumeru/core";
import { defaultSpawn, defaultStreamingSpawn } from "./spawn.js";
import { parseCodexJson, parseCodexJsonIncremental } from "./stream-parser.js";
import type {
	CodexAdapterOptions,
	CodexParsedResult,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
} from "./types.js";

const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CREATE_TIMEOUT_MS = 5 * 60_000;
/**
 * Default `send` timeout — 2 hours.
 *
 * Consistent with adapter-claude-code. Raised from 30 minutes (issue #92) so
 * long-running tasks are not killed mid-execution. Kept finite (not null): the
 * timeout doubles as a wedged-process detector that #95 (timeout-as-suspend)
 * will reuse. Operators may override via the
 * `gateways.<name>.config.sendTimeoutMs` field in `sumeru.yaml`.
 */
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

export function createCodexAdapter(
	options: Partial<CodexAdapterOptions> = {},
): Adapter {
	const codexBin = options.codexBin ?? DEFAULT_CODEX_BIN;
	const defaultModel = options.model ?? null;
	const cwd = options.cwd ?? null;
	const createSessionTimeoutMs =
		options.createSessionTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const spawnFn: SpawnFn = options.spawnFn ?? defaultSpawn;
	const streamingSpawnFn: StreamingSpawnFn =
		options.streamingSpawnFn ?? defaultStreamingSpawn;
	const dangerouslyBypassApprovals = options.dangerouslyBypassApprovals ?? true;
	const skipGitRepoCheck = options.skipGitRepoCheck ?? true;

	const turnsCache = new Map<string, Turn[]>();
	const closedRefs = new Set<string>();
	const sendLocks = new Map<string, Promise<unknown>>();

	function resolveCwd(): string {
		return cwd ?? process.cwd();
	}

	function buildArgs(
		prompt: string,
		resumeId: string | null,
		model: string | null,
		spawnCwd: string,
	): string[] {
		const args: string[] = ["exec"];

		// Resume mode: `codex exec resume <id> "<prompt>"`
		if (resumeId !== null) {
			args.push("resume", resumeId);
		}

		// Add the prompt
		args.push(prompt);

		// Add --json for JSONL output
		args.push("--json");

		// Add permission bypass flags if enabled
		if (dangerouslyBypassApprovals) {
			args.push("--dangerously-bypass-approvals-and-sandbox");
		}

		if (skipGitRepoCheck) {
			args.push("--skip-git-repo-check");
		}

		// Add working directory
		args.push("-C", spawnCwd);

		// Add model if specified
		if (model !== null) {
			args.push("-m", model);
		}

		return args;
	}

	async function runCodex(
		prompt: string,
		resumeId: string | null,
		model: string | null,
		timeoutMs: number,
		spawnCwd: string,
	): Promise<{ result: SpawnResult; parsed: CodexParsedResult | null }> {
		const args = buildArgs(prompt, resumeId, model, spawnCwd);
		const result = await spawnFn({
			command: codexBin,
			args,
			timeoutMs,
			cwd: spawnCwd,
		}).catch((err) => {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`codex adapter failed to spawn '${codexBin}': ${detail}`);
		});
		const parsed = parseCodexJson(result.stdout);
		return { result, parsed };
	}

	async function createSession(
		config: SessionConfig,
	): Promise<NativeSessionRef> {
		const model = config.model ?? defaultModel;
		const spawnCwd = config.cwd ?? resolveCwd();

		const { result, parsed } = await runCodex(
			"ping",
			null,
			model,
			createSessionTimeoutMs,
			spawnCwd,
		);

		if (result.timedOut) {
			throw new Error(
				`createSession timed out after ${createSessionTimeoutMs}ms`,
			);
		}

		if (parsed === null) {
			throw makeUnparseableOrExitError(result, codexBin);
		}

		// Parsed but no session id — treat as unparseable.
		if (parsed.sessionId === "") {
			throw makeUnparseableOrExitError(result, codexBin);
		}

		// Adapter rewrites indices to be globally monotonic from 0.
		const rewritten = rewriteIndices(parsed.turns, -1);
		turnsCache.set(parsed.sessionId, rewritten);

		const meta: Record<string, unknown> = {
			cwd: spawnCwd,
			model: parsed.model !== "" ? parsed.model : model,
			createdAt: new Date().toISOString(),
			subtype: parsed.subtype,
		};
		return { nativeId: parsed.sessionId, meta };
	}

	function send(
		ref: NativeSessionRef,
		content: string,
	): AsyncIterable<SendEvent> {
		assertRef(ref, "send");
		if (closedRefs.has(ref.nativeId)) {
			throw new Error(`codex session ${ref.nativeId} is closed`);
		}
		if (typeof content !== "string" || content.length === 0) {
			throw new Error("send: content must be a non-empty string");
		}

		const nativeId = ref.nativeId;

		async function* generate(): AsyncGenerator<SendEvent> {
			// Acquire the lock — it stays held until this generator finishes.
			const prev = sendLocks.get(nativeId) ?? Promise.resolve();
			let release: () => void = () => {};
			const next = new Promise<void>((resolve) => {
				release = resolve;
			});
			const chain = prev.then(() => next);
			sendLocks.set(nativeId, chain);

			try {
				await prev;
				yield* streamSend(nativeId, ref, content);
			} finally {
				release();
				if (sendLocks.get(nativeId) === chain) {
					sendLocks.delete(nativeId);
				}
			}
		}

		return generate();
	}

	async function* streamSend(
		nativeId: string,
		ref: NativeSessionRef,
		content: string,
	): AsyncGenerator<SendEvent> {
		if (closedRefs.has(nativeId)) {
			yield {
				type: "error" as const,
				error: new Error(`codex session ${nativeId} is closed`),
			};
			return;
		}

		const before = turnsCache.get(nativeId) ?? [];
		const highWater =
			before.length === 0
				? -1
				: before.reduce((m, t) => (t.index > m ? t.index : m), -1);
		let nextIndex = highWater + 1;

		const refModel =
			typeof ref.meta.model === "string" && ref.meta.model.length > 0
				? ref.meta.model
				: defaultModel;
		const refCwd =
			typeof ref.meta.cwd === "string" && ref.meta.cwd.length > 0
				? ref.meta.cwd
				: resolveCwd();

		const args = buildArgs(content, nativeId, refModel, refCwd);
		const startedAt = Date.now();

		let streamResult: SpawnStreamResult;
		try {
			streamResult = streamingSpawnFn({
				command: codexBin,
				args,
				timeoutMs: sendTimeoutMs,
				cwd: refCwd,
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			yield {
				type: "error" as const,
				error: new Error(
					`codex adapter failed to spawn '${codexBin}': ${detail}`,
				),
			};
			return;
		}

		let resultLine: Record<string, unknown> | null = null;

		try {
			for await (const event of parseCodexJsonIncremental(streamResult.lines)) {
				if (event.type === "turn") {
					const turn = event.turn;
					turn.index = nextIndex++;
					const existing = turnsCache.get(nativeId) ?? [];
					turnsCache.set(nativeId, [...existing, turn]);
					yield { type: "turn", turn };
				} else if (event.type === "result") {
					resultLine = event.resultLine;
				}
			}
		} catch (err) {
			yield {
				type: "error" as const,
				error:
					err instanceof Error
						? err
						: new Error(`stream read error: ${String(err)}`),
			};
			return;
		}

		let exitInfo: SpawnExitInfo;
		try {
			exitInfo = await streamResult.waitForExit();
		} catch (err) {
			yield {
				type: "error" as const,
				error:
					err instanceof Error
						? err
						: new Error(`process exit error: ${String(err)}`),
			};
			return;
		}

		if (exitInfo.timedOut) {
			yield {
				type: "suspend" as const,
				reason: "timeout",
				nativeId,
				elapsedMs: exitInfo.durationMs,
			};
			return;
		}

		if (exitInfo.exitCode !== null && exitInfo.exitCode !== 0) {
			const stderrTrimmed = exitInfo.stderr.trim();
			const snippet =
				stderrTrimmed === ""
					? ""
					: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
			yield {
				type: "error" as const,
				error: new Error(
					`codex exited with code ${String(exitInfo.exitCode)}${snippet}`,
				),
			};
			return;
		}

		const tokens = deriveTokensFromResultLine(resultLine);
		yield {
			type: "done",
			durationMs: Date.now() - startedAt,
			tokens,
		};
	}

	async function close(ref: NativeSessionRef): Promise<void> {
		assertRef(ref, "close");
		closedRefs.add(ref.nativeId);
	}

	async function getTurns(ref: NativeSessionRef): Promise<Turn[]> {
		assertRef(ref, "getTurns");
		const cached = turnsCache.get(ref.nativeId);
		if (cached === undefined) return [];
		return [...cached];
	}

	return {
		name: "codex",
		createSession,
		send,
		close,
		getTurns,
	};
}

function assertRef(
	ref: NativeSessionRef | null | undefined,
	op: "send" | "close" | "getTurns",
): void {
	if (
		ref === null ||
		ref === undefined ||
		typeof ref !== "object" ||
		typeof (ref as NativeSessionRef).nativeId !== "string" ||
		(ref as NativeSessionRef).nativeId.length === 0
	) {
		throw new Error(`${op}: invalid NativeSessionRef`);
	}
}

function rewriteIndices(turns: Turn[], highWater: number): Turn[] {
	let nextIndex = highWater + 1;
	return turns.map((turn) => ({
		...turn,
		index: nextIndex++,
	}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(v: unknown, fallback = 0): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function deriveTokensFromResultLine(
	resultLine: Record<string, unknown> | null,
): TokenUsage | null {
	if (resultLine === null) return null;
	const usage = isRecord(resultLine.usage) ? resultLine.usage : resultLine;
	const input = safeNumber(
		usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens,
	);
	const output = safeNumber(
		usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens,
	);
	if (input === 0 && output === 0) return null;
	return { input, output };
}

function makeUnparseableOrExitError(
	result: SpawnResult,
	codexBin: string,
	nativeId: string | null = null,
): Error {
	const stderr = result.stderr ?? "";
	const stdout = result.stdout ?? "";
	const stderrTrimmed = stderr.trim();

	// API key errors take precedence over generic exit errors.
	for (const pattern of API_KEY_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				result.exitCode === null ? "null" : String(result.exitCode);
			return new Error(
				`codex exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`,
			);
		}
	}

	// Session-not-found heuristic for resume failures.
	if (nativeId !== null && /not found|no such session/i.test(stderrTrimmed)) {
		return new Error(
			`codex session ${nativeId} not found: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`,
		);
	}

	if (result.exitCode !== null && result.exitCode !== 0) {
		const codeText = String(result.exitCode);
		const snippet =
			stderrTrimmed === ""
				? ""
				: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
		return new Error(`codex exited with code ${codeText}${snippet}`);
	}

	// Unparseable but exit was 0 (or null) — generic parse error referencing
	// codexBin so callers can debug a misconfigured PATH.
	const head = stdout.slice(0, 500);
	const stderrTail = tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT);
	return new Error(
		`codex returned unparseable json output (bin=${codexBin}, first 500 chars: ${head}, stderr tail: ${stderrTail})`,
	);
}

function tail(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(s.length - n);
}
