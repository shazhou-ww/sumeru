/**
 * Claude Code adapter — implements the `Adapter` contract from `@sumeru/core`
 * by shelling out to `claude -p <prompt> --output-format stream-json --verbose
 * --dangerously-skip-permissions --max-turns <n>` for create/send and parsing
 * the resulting NDJSON stream into `Turn[]`.
 *
 * Claude Code does NOT expose a stable on-disk session DB; the adapter
 * therefore caches parsed turns in an in-memory `Map<string, Turn[]>` keyed by
 * `nativeId` and is the sole authority on history for the lifetime of the
 * adapter instance. (This is the key architectural difference from
 * `adapter-hermes`, which reads from `~/.hermes/state.db` / JSONL.)
 *
 * The factory:
 *   - createSession spawns `claude -p "ping" --output-format stream-json
 *     --verbose --dangerously-skip-permissions --max-turns <n>` and parses the
 *     `system` line for the CC session id. Accepts `SessionConfig` with
 *     `model` and `cwd` fields; always uses a fixed "ping" prompt.
 *   - send is an async generator that spawns `claude -p <content> --resume
 *     <id> ...`, rewrites the per-run turn indices CC produces so they are
 *     globally monotonic across the whole `nativeId` lifetime, and yields
 *     `SendEvent`s (`turn`, `done`, or `error`).
 *   - close is a logical close — adds the nativeId to a per-instance Set; no
 *     CC-side notification, no cache eviction.
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
import {
	parseStreamJson,
	parseStreamJsonIncremental,
} from "./stream-parser.js";
import type {
	ClaudeCodeAdapterOptions,
	ClaudeCodeParsedResult,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
} from "./types.js";

const DEFAULT_CLAUDE_BIN = "claude";
const DEFAULT_MAX_TURNS = 90;
const DEFAULT_CREATE_TIMEOUT_MS = 5 * 60_000;
/**
 * Default `send` timeout — 2 hours.
 *
 * Raised from 30 minutes (issue #92) so long-running solve-issue developer
 * runs do not get killed mid-execution. Kept finite (not null) on purpose:
 * the timeout doubles as a wedged-process detector, and #95 (timeout-as-suspend)
 * will reuse this trigger to turn a timeout into a resumable suspend rather than
 * a hard failure. Operators may override via the
 * `gateways.<name>.config.sendTimeoutMs` field in `sumeru.yaml`.
 */
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
	options: Partial<ClaudeCodeAdapterOptions> = {},
): Adapter {
	const claudeBin = options.claudeBin ?? DEFAULT_CLAUDE_BIN;
	const defaultModel = options.model ?? null;
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	const cwd = options.cwd ?? null;
	const createSessionTimeoutMs =
		options.createSessionTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const spawnFn: SpawnFn = options.spawnFn ?? defaultSpawn;
	const streamingSpawnFn: StreamingSpawnFn =
		options.streamingSpawnFn ?? defaultStreamingSpawn;

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
	): string[] {
		const args = ["-p", prompt];
		if (resumeId !== null) {
			args.push("--resume", resumeId);
		}
		args.push(
			"--output-format",
			"stream-json",
			"--verbose",
			// TODO(permission-suspend): `--dangerously-skip-permissions` is a
			// TEMPORARY measure. It bypasses ALL of Claude Code's permission
			// checks so unattended uwf/Sumeru runs don't deadlock on a prompt.
			// The intended replacement: run CC with
			//   `--input-format stream-json --output-format stream-json --include-hook-events`
			// catch the permission-request hook event on the stream, and instead
			// of auto-approving, propagate it UP as a uwf `$SUSPEND` so a human
			// supervisor can approve/deny via `uwf thread resume`. This is a
			// cross-layer change (CC hook → Sumeru SSE → agent-sumeru → uwf step
			// boundary) — see cards/adapter-claude-code.md "Permission Handling".
			// Until then: only run this adapter in trusted, sandboxed cwds.
			"--dangerously-skip-permissions",
			"--max-turns",
			String(maxTurns),
		);
		if (model !== null) {
			args.push("--model", model);
		}
		return args;
	}

	async function runClaude(
		prompt: string,
		resumeId: string | null,
		model: string | null,
		timeoutMs: number,
		spawnCwd: string,
	): Promise<{ result: SpawnResult; parsed: ClaudeCodeParsedResult | null }> {
		const args = buildArgs(prompt, resumeId, model);
		const result = await spawnFn({
			command: claudeBin,
			args,
			timeoutMs,
			cwd: spawnCwd,
		}).catch((err) => {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`claude code adapter failed to spawn '${claudeBin}': ${detail}`,
			);
		});
		const parsed = parseStreamJson(result.stdout);
		return { result, parsed };
	}

	async function createSession(
		config: SessionConfig,
	): Promise<NativeSessionRef> {
		// Case 4: a non-null, non-string cwd is a programming error — reject
		// before spawning. `null` is "absent" (legal); only a wrong type rejects.
		// Runs BEFORE the empty-string / resolveCwd computation below.
		if (config.cwd !== null && typeof config.cwd !== "string") {
			throw new Error("createSession: config.cwd must be a string or null");
		}

		const model =
			config.model !== null && config.model.length > 0
				? config.model
				: defaultModel;
		const spawnCwd =
			config.cwd !== null && config.cwd.length > 0 ? config.cwd : resolveCwd();

		const { result, parsed } = await runClaude(
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
			throw makeUnparseableOrExitError(result, claudeBin);
		}

		// Parsed but no session id — treat as unparseable.
		if (parsed.sessionId === "") {
			throw makeUnparseableOrExitError(result, claudeBin);
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
		// Synchronous pre-checks — throw before returning the iterable.
		assertRef(ref, "send");
		if (closedRefs.has(ref.nativeId)) {
			throw new Error(`claude code session ${ref.nativeId} is closed`);
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
		// Re-check closed state inside the lock — another send may have
		// closed the session while we were queued.
		if (closedRefs.has(nativeId)) {
			yield {
				type: "error" as const,
				error: new Error(`claude code session ${nativeId} is closed`),
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

		const args = buildArgs(content, nativeId, refModel);
		const startedAt = Date.now();

		let streamResult: SpawnStreamResult;
		try {
			streamResult = streamingSpawnFn({
				command: claudeBin,
				args,
				timeoutMs: sendTimeoutMs,
				cwd: refCwd,
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			yield {
				type: "error" as const,
				error: new Error(
					`claude code adapter failed to spawn '${claudeBin}': ${detail}`,
				),
			};
			return;
		}

		let resultLine: Record<string, unknown> | null = null;

		try {
			for await (const event of parseStreamJsonIncremental(
				streamResult.lines,
			)) {
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
			// Stream read error — partial turns already in cache
			yield {
				type: "error" as const,
				error:
					err instanceof Error
						? err
						: new Error(`stream read error: ${String(err)}`),
			};
			return;
		}

		// Await exit info
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
				type: "error" as const,
				error: new Error(`send timed out after ${sendTimeoutMs}ms`),
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
					`claude exited with code ${String(exitInfo.exitCode)}${snippet}`,
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
		name: "claude-code",
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
	const usage = isRecord(resultLine.usage) ? resultLine.usage : {};
	const input = safeNumber(usage.input_tokens);
	const output = safeNumber(usage.output_tokens);
	if (input === 0 && output === 0) return null;
	return { input, output };
}

function makeUnparseableOrExitError(
	result: SpawnResult,
	claudeBin: string,
	nativeId: string | null = null,
): Error {
	const stderr = result.stderr ?? "";
	const stdout = result.stdout ?? "";
	const stderrTrimmed = stderr.trim();

	// Login / API key errors take precedence over generic exit errors.
	if (/not logged in/i.test(stderrTrimmed)) {
		const codeText =
			result.exitCode === null ? "null" : String(result.exitCode);
		return new Error(
			`claude exited with code ${codeText}: ${NOT_LOGGED_IN_MESSAGE}`,
		);
	}
	for (const pattern of API_KEY_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				result.exitCode === null ? "null" : String(result.exitCode);
			return new Error(
				`claude exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`,
			);
		}
	}

	// Session-not-found heuristic for resume failures.
	if (nativeId !== null && /not found|no such session/i.test(stderrTrimmed)) {
		return new Error(
			`claude code session ${nativeId} not found: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`,
		);
	}

	if (result.exitCode !== null && result.exitCode !== 0) {
		const codeText = String(result.exitCode);
		const snippet =
			stderrTrimmed === ""
				? ""
				: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
		return new Error(`claude exited with code ${codeText}${snippet}`);
	}

	// Unparseable but exit was 0 (or null) — generic parse error referencing
	// claudeBin so callers can debug a misconfigured PATH.
	const head = stdout.slice(0, 500);
	const stderrTail = tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT);
	return new Error(
		`claude code returned unparseable stream-json output (bin=${claudeBin}, first 500 chars: ${head}, stderr tail: ${stderrTail})`,
	);
}

function tail(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(s.length - n);
}
