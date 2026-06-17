/**
 * Cursor Agent adapter — implements the `Adapter` contract from `@sumeru/core`
 * by shelling out to `cursor-agent -p <prompt> --print --output-format
 * stream-json --trust --force --workspace <cwd>` for create/send and parsing
 * the resulting NDJSON stream into `Turn[]`.
 *
 * cursor-agent does NOT expose a stable on-disk session DB; the adapter
 * therefore caches parsed turns in an in-memory `Map<string, Turn[]>` keyed by
 * `nativeId` and is the sole authority on history for the lifetime of the
 * adapter instance.
 *
 * The factory:
 *   - createSession spawns `cursor-agent -p <initialQuery> --print
 *     --output-format stream-json --trust --force --workspace <cwd>` and
 *     parses the `system` line for the session id.
 *   - send spawns `cursor-agent -p <content> --resume <id> ...` and rewrites
 *     the per-run turn indices so they are globally monotonic across the whole
 *     `nativeId` lifetime.
 *   - close is a logical close — adds the nativeId to a per-instance Set; no
 *     cursor-agent-side notification, no cache eviction.
 *   - getTurns returns a defensive copy of the in-memory cache.
 */

import type {
	Adapter,
	AgentResponse,
	NativeSessionRef,
	TokenUsage,
	Turn,
} from "@sumeru/core";
import { defaultSpawn } from "./spawn.js";
import { parseStreamJson } from "./stream-parser.js";
import type {
	CursorAgentAdapterOptions,
	CursorAgentParsedResult,
	SpawnFn,
	SpawnResult,
} from "./types.js";

const DEFAULT_CURSOR_AGENT_BIN = "cursor-agent";
const DEFAULT_CREATE_TIMEOUT_MS = 5 * 60_000;
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

export function createCursorAgentAdapter(
	options: Partial<CursorAgentAdapterOptions> = {},
): Adapter {
	const cursorAgentBin = options.cursorAgentBin ?? DEFAULT_CURSOR_AGENT_BIN;
	const defaultModel = options.model ?? null;
	const cwd = options.cwd ?? null;
	const createSessionTimeoutMs =
		options.createSessionTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const spawnFn: SpawnFn = options.spawnFn ?? defaultSpawn;
	const permissionMode = options.permissionMode ?? "force";
	const sandbox = options.sandbox ?? null;

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

	async function withRefLock<T>(
		nativeId: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const prev = sendLocks.get(nativeId) ?? Promise.resolve();
		let release: () => void = () => {};
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		const chain = prev.then(() => next);
		sendLocks.set(nativeId, chain);
		try {
			await prev;
			return await fn();
		} finally {
			release();
			if (sendLocks.get(nativeId) === chain) {
				sendLocks.delete(nativeId);
			}
		}
	}

	async function runCursorAgent(
		prompt: string,
		resumeId: string | null,
		model: string | null,
		timeoutMs: number,
		spawnCwd: string,
	): Promise<{ result: SpawnResult; parsed: CursorAgentParsedResult | null }> {
		const args = buildArgs(prompt, resumeId, model, spawnCwd);
		const result = await spawnFn({
			command: cursorAgentBin,
			args,
			timeoutMs,
			cwd: spawnCwd,
		}).catch((err) => {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`cursor-agent adapter failed to spawn '${cursorAgentBin}': ${detail}`,
			);
		});
		const parsed = parseStreamJson(result.stdout);
		return { result, parsed };
	}

	async function createSession(
		config: Record<string, unknown>,
	): Promise<NativeSessionRef> {
		const initialQuery =
			typeof config.initialQuery === "string" && config.initialQuery.length > 0
				? config.initialQuery
				: "ping";
		const model =
			typeof config.model === "string" && config.model.length > 0
				? config.model
				: defaultModel;
		const spawnCwd = resolveCwd();

		const { result, parsed } = await runCursorAgent(
			initialQuery,
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
			throw makeUnparseableOrExitError(result, cursorAgentBin);
		}

		if (parsed.sessionId === "") {
			throw makeUnparseableOrExitError(result, cursorAgentBin);
		}

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

	async function send(
		ref: NativeSessionRef,
		content: string,
	): Promise<AgentResponse> {
		assertRef(ref, "send");
		if (closedRefs.has(ref.nativeId)) {
			throw new Error(`cursor-agent session ${ref.nativeId} is closed`);
		}
		if (typeof content !== "string" || content.length === 0) {
			throw new Error("send: content must be a non-empty string");
		}

		return withRefLock(ref.nativeId, async () => {
			const before = turnsCache.get(ref.nativeId) ?? [];
			const highWater =
				before.length === 0
					? -1
					: before.reduce((m, t) => (t.index > m ? t.index : m), -1);

			const refModel =
				typeof ref.meta.model === "string" && ref.meta.model.length > 0
					? ref.meta.model
					: defaultModel;
			const refCwd =
				typeof ref.meta.cwd === "string" && ref.meta.cwd.length > 0
					? ref.meta.cwd
					: resolveCwd();

			const startedAt = Date.now();
			const { result, parsed } = await runCursorAgent(
				content,
				ref.nativeId,
				refModel,
				sendTimeoutMs,
				refCwd,
			);

			if (result.timedOut) {
				throw new Error(`send timed out after ${sendTimeoutMs}ms`);
			}

			if (parsed === null) {
				throw makeUnparseableOrExitError(result, cursorAgentBin, ref.nativeId);
			}

			const delta = rewriteIndices(parsed.turns, highWater);
			const existing = turnsCache.get(ref.nativeId) ?? [];
			turnsCache.set(ref.nativeId, [...existing, ...delta]);

			const tokens = deriveTokens(parsed);
			return {
				turns: delta,
				tokens,
				durationMs: Date.now() - startedAt,
			};
		});
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
		name: "cursor-agent",
		capabilities: { resume: true, streaming: false },
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

function deriveTokens(parsed: CursorAgentParsedResult): TokenUsage | null {
	const input = parsed.usage.inputTokens;
	const output = parsed.usage.outputTokens;
	if (input === 0 && output === 0 && parsed.subtype === "incomplete") {
		return null;
	}
	return { input, output };
}

function makeUnparseableOrExitError(
	result: SpawnResult,
	cursorAgentBin: string,
	nativeId: string | null = null,
): Error {
	const stderr = result.stderr ?? "";
	const stdout = result.stdout ?? "";
	const stderrTrimmed = stderr.trim();

	// API key errors take precedence.
	for (const pattern of API_KEY_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				result.exitCode === null ? "null" : String(result.exitCode);
			return new Error(
				`cursor-agent exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`,
			);
		}
	}

	// Trust errors.
	for (const pattern of TRUST_PATTERNS) {
		if (pattern.test(stderrTrimmed)) {
			const codeText =
				result.exitCode === null ? "null" : String(result.exitCode);
			return new Error(
				`cursor-agent exited with code ${codeText}: ${TRUST_ERROR_MESSAGE}`,
			);
		}
	}

	// Session-not-found heuristic for resume failures.
	if (
		nativeId !== null &&
		/not found|no such session|session.*not.*exist/i.test(stderrTrimmed)
	) {
		return new Error(
			`cursor-agent session ${nativeId} not found: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`,
		);
	}

	if (result.exitCode !== null && result.exitCode !== 0) {
		const codeText = String(result.exitCode);
		const snippet =
			stderrTrimmed === ""
				? ""
				: `: ${tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT)}`;
		return new Error(`cursor-agent exited with code ${codeText}${snippet}`);
	}

	// Unparseable but exit was 0 (or null).
	const head = stdout.slice(0, 500);
	const stderrTail = tail(stderrTrimmed, STDERR_TRUNCATE_LIMIT);
	return new Error(
		`cursor-agent returned unparseable stream-json output (bin=${cursorAgentBin}, first 500 chars: ${head}, stderr tail: ${stderrTail})`,
	);
}

function tail(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(s.length - n);
}
