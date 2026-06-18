/**
 * Hermes adapter — implements the `Adapter` contract from `@sumeru/core`
 * by shelling out to `hermes chat -q` for create/send and reading turn
 * history from per-session JSONL files (hermes v0.15.1+) with a SQLite
 * fallback for older or alternate hermes builds.
 *
 * Design notes:
 *   - createSession spawns `hermes chat -q "ping" --pass-session-id --quiet`
 *     and parses the printed session id line. Accepts `SessionConfig` with
 *     `model` and `cwd` fields.
 *   - send is an async generator that spawns `hermes chat -q "<content>"
 *     --resume <id>`, waits for exit, reads delta turns, then yields each
 *     turn as `{ type: "turn", turn }` followed by `{ type: "done", ... }`.
 *   - close is a logical close — adds the nativeId to a per-instance Set;
 *     no DB mutation, no process spawn.
 *   - getTurns reads `<sessionsDir>/<nativeId>.jsonl` first; on absence falls
 *     back to `~/.hermes/state.db` via `node:sqlite`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type {
	Adapter,
	NativeSessionRef,
	SendEvent,
	SessionConfig,
	TokenUsage,
	Turn,
} from "@sumeru/core";
import { readTurnsFromDb } from "./db.js";
import { readTurnsFromJsonl } from "./jsonl.js";
import { defaultSpawn } from "./spawn.js";
import type {
	HermesAdapterOptions,
	JsonlReader,
	SpawnFn,
	TurnsReader,
} from "./types.js";

const DEFAULT_HERMES_BIN = "hermes";
const DEFAULT_SOURCE_TAG = "sumeru";
const DEFAULT_CREATE_TIMEOUT_MS = 60_000;
const DEFAULT_SEND_TIMEOUT_MS = 5 * 60_000;

const SESSION_ID_RE = /^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/;
const SESSION_LINE_RE = /^(?:Session:|session_id:)\s+(\S+)\s*$/m;

export function createHermesAdapter(
	options: Partial<HermesAdapterOptions> = {},
): Adapter {
	const hermesBin = options.hermesBin ?? DEFAULT_HERMES_BIN;
	const sourceTag = options.sourceTag ?? DEFAULT_SOURCE_TAG;
	const dbPath = options.dbPath ?? join(homedir(), ".hermes", "state.db");
	const sessionsDir =
		options.sessionsDir ?? join(homedir(), ".hermes", "sessions");
	const createSessionTimeoutMs =
		options.createSessionTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
	const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const includeSystemTurns = options.includeSystemTurns ?? false;
	const spawnFn: SpawnFn = options.spawnFn ?? defaultSpawn;
	const turnsReader: TurnsReader =
		options.turnsReader ?? ((p, n) => readTurnsFromDb(p, n));
	const jsonlReader: JsonlReader =
		options.jsonlReader ?? ((d, n) => readTurnsFromJsonl(d, n));

	const closedRefs = new Set<string>();
	const sendLocks = new Map<string, Promise<unknown>>();

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

	/**
	 * JSONL-first read of session turns. JSONL files are the source of truth
	 * for hermes v0.15.1+; the SQLite DB is a fallback for older/alternate
	 * builds. Returns `[]` for an unknown session — never throws "session not
	 * found".
	 */
	async function readAllTurns(nativeId: string): Promise<Turn[]> {
		const fromJsonl = await jsonlReader(sessionsDir, nativeId).catch(
			() => null,
		);
		if (fromJsonl !== null) return fromJsonl;
		try {
			return await turnsReader(dbPath, nativeId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (/not found/i.test(message)) return [];
			throw err;
		}
	}

	async function createSession(
		config: SessionConfig,
	): Promise<NativeSessionRef> {
		const args = ["chat", "-q", "ping", "--pass-session-id", "--quiet"];
		args.push("--source", sourceTag);
		if (config.model !== null) {
			args.push("--model", config.model);
		}

		const spawnCwd = config.cwd ?? undefined;

		const result = await spawnFn({
			command: hermesBin,
			args,
			timeoutMs: createSessionTimeoutMs,
			...(spawnCwd !== undefined ? { cwd: spawnCwd } : {}),
		}).catch((err) => {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`hermes adapter failed to spawn '${hermesBin}': ${detail}`,
			);
		});

		if (result.timedOut) {
			throw new Error(
				`createSession timed out after ${createSessionTimeoutMs}ms`,
			);
		}
		if (result.exitCode !== 0) {
			const tail = tail500(result.stderr || result.stdout);
			throw new Error(
				`hermes exited with code ${result.exitCode ?? "(none)"}: ${tail}`,
			);
		}

		// hermes v0.15.1 writes `session_id: <id>` to stderr (NOT stdout).
		// Older versions write `Session: <id>` to stdout. Merge stderr first so
		// new format wins when both are present, and accept either label.
		const merged = `${result.stderr}\n${result.stdout}`;
		const match = merged.match(SESSION_LINE_RE);
		if (match === null || match[1] === undefined) {
			const head = merged.slice(0, 500);
			throw new Error(
				`failed to parse Hermes session id from stderr+stdout (first 500 chars): ${head}`,
			);
		}
		const nativeId = match[1];
		if (!SESSION_ID_RE.test(nativeId)) {
			throw new Error(
				`failed to parse Hermes session id (got '${nativeId}', expected YYYYMMDD_HHMMSS_<hex>)`,
			);
		}

		const meta: Record<string, unknown> = {
			sourceTag,
			cwd: config.cwd ?? process.cwd(),
			model: config.model,
			createdAt: new Date().toISOString(),
		};
		return { nativeId, meta };
	}

	function send(
		ref: NativeSessionRef,
		content: string,
	): AsyncIterable<SendEvent> {
		assertRef(ref);
		if (closedRefs.has(ref.nativeId)) {
			throw new Error(`hermes session ${ref.nativeId} is closed`);
		}
		if (typeof content !== "string" || content.length === 0) {
			throw new Error("send: content must be a non-empty string");
		}

		const nativeId = ref.nativeId;

		async function* generate(): AsyncGenerator<SendEvent> {
			const events: SendEvent[] = await withRefLock(nativeId, async () => {
				if (closedRefs.has(nativeId)) {
					return [
						{
							type: "error" as const,
							error: new Error(`hermes session ${nativeId} is closed`),
						},
					];
				}
				const before = await readAllTurns(nativeId).catch(() => []);
				const highWater =
					before.length === 0
						? -1
						: before.reduce((m, t) => (t.index > m ? t.index : m), -1);

				const args = [
					"chat",
					"-q",
					content,
					"--resume",
					nativeId,
					"--pass-session-id",
					"--quiet",
					"--source",
					sourceTag,
				];

				const startedAt = Date.now();
				let result: Awaited<ReturnType<SpawnFn>>;
				try {
					result = await spawnFn({
						command: hermesBin,
						args,
						timeoutMs: sendTimeoutMs,
					});
				} catch (err) {
					const detail = err instanceof Error ? err.message : String(err);
					return [
						{
							type: "error" as const,
							error: new Error(`hermes exited with spawn failure: ${detail}`),
						},
					];
				}

				if (result.timedOut) {
					return [
						{
							type: "error" as const,
							error: new Error(`send timed out after ${sendTimeoutMs}ms`),
						},
					];
				}
				if (result.exitCode !== 0) {
					const tail = tail500(result.stderr || result.stdout);
					const stderrLower = (result.stderr ?? "").toLowerCase();
					let msg: string;
					if (
						stderrLower.includes("not found") ||
						stderrLower.includes("no such session")
					) {
						msg = `hermes session ${nativeId} not found: ${tail}`;
					} else {
						msg = `hermes exited with code ${result.exitCode ?? "(none)"}: ${tail}`;
					}
					return [{ type: "error" as const, error: new Error(msg) }];
				}

				const after = await readAllTurns(nativeId);
				const delta = after.filter((t) => t.index > highWater);
				const filtered = includeSystemTurns
					? delta
					: delta.filter((t) => t.role !== "system");
				const tokens = aggregateTokens(filtered);

				const result_events: SendEvent[] = [];
				for (const turn of filtered) {
					result_events.push({ type: "turn", turn });
				}
				result_events.push({
					type: "done",
					durationMs: Date.now() - startedAt,
					tokens,
				});
				return result_events;
			});

			for (const event of events) {
				yield event;
			}
		}

		return generate();
	}

	async function close(ref: NativeSessionRef): Promise<void> {
		assertRef(ref);
		closedRefs.add(ref.nativeId);
	}

	async function getTurns(ref: NativeSessionRef): Promise<Turn[]> {
		assertRef(ref);
		const turns = await readAllTurns(ref.nativeId);
		return includeSystemTurns
			? turns
			: turns.filter((t) => t.role !== "system");
	}

	return {
		name: "hermes",
		createSession,
		send,
		close,
		getTurns,
	};
}

function assertRef(ref: NativeSessionRef | null | undefined): void {
	if (
		ref === null ||
		ref === undefined ||
		typeof ref !== "object" ||
		typeof (ref as NativeSessionRef).nativeId !== "string" ||
		(ref as NativeSessionRef).nativeId.length === 0
	) {
		throw new Error("close: invalid NativeSessionRef");
	}
}

function tail500(s: string): string {
	if (s.length <= 500) return s;
	return s.slice(s.length - 500);
}

function aggregateTokens(turns: Turn[]): TokenUsage | null {
	let any = false;
	let input = 0;
	let output = 0;
	for (const turn of turns) {
		if (turn.tokens === undefined || turn.tokens === null) continue;
		any = true;
		input += turn.tokens.input;
		output += turn.tokens.output;
	}
	return any ? { input, output } : null;
}
