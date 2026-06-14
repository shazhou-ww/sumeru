/**
 * Hermes adapter — implements the `Adapter` contract from `@sumeru/core`
 * by shelling out to `hermes chat -q` for create/send and reading turn
 * history from per-session JSONL files (hermes v0.15.1+) with a SQLite
 * fallback for older or alternate hermes builds.
 *
 * Design notes:
 *   - createSession spawns `hermes chat -q "<initialQuery>" --pass-session-id --quiet`
 *     and parses the printed session id line. Hermes v0.15.1 prints the line to
 *     **stderr**, older versions to stdout; the adapter merges both streams and
 *     accepts either `session_id: <id>` (new) or `Session: <id>` (legacy).
 *   - send uses `hermes chat -q "<content>" --resume <id>` and returns the
 *     **delta** turns recorded since the call started (per-nativeId mutex).
 *   - close is a logical close — adds the nativeId to a per-instance Set;
 *     no DB mutation, no process spawn.
 *   - getTurns reads `<sessionsDir>/<nativeId>.jsonl` first; on absence falls
 *     back to `~/.hermes/sessions.db` via `node:sqlite`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type {
	Adapter,
	AgentResponse,
	NativeSessionRef,
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

const ALLOWED_CONFIG_KEYS = [
	"model",
	"provider",
	"toolsets",
	"skills",
	"worktree",
	"acceptHooks",
	"yolo",
	"maxTurns",
	"ignoreUserConfig",
	"ignoreRules",
] as const;

export function createHermesAdapter(
	options: Partial<HermesAdapterOptions> = {},
): Adapter {
	const hermesBin = options.hermesBin ?? DEFAULT_HERMES_BIN;
	const sourceTag = options.sourceTag ?? DEFAULT_SOURCE_TAG;
	const dbPath = options.dbPath ?? join(homedir(), ".hermes", "sessions.db");
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
		sendLocks.set(
			nativeId,
			prev.then(() => next),
		);
		try {
			await prev;
			return await fn();
		} finally {
			release();
			if (sendLocks.get(nativeId) === prev.then(() => next)) {
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
		config: Record<string, unknown>,
	): Promise<NativeSessionRef> {
		const initialQuery =
			typeof config.initialQuery === "string" && config.initialQuery.length > 0
				? config.initialQuery
				: "ping";
		const args = ["chat", "-q", initialQuery, "--pass-session-id", "--quiet"];
		args.push("--source", sourceTag);
		for (const key of ALLOWED_CONFIG_KEYS) {
			const value = config[key];
			if (value === undefined || value === null) continue;
			pushFlag(args, key, value);
		}

		const result = await spawnFn({
			command: hermesBin,
			args,
			timeoutMs: createSessionTimeoutMs,
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
			cwd: process.cwd(),
			model: typeof config.model === "string" ? config.model : null,
			createdAt: new Date().toISOString(),
		};
		return { nativeId, meta };
	}

	async function send(
		ref: NativeSessionRef,
		content: string,
	): Promise<AgentResponse> {
		assertRef(ref);
		if (closedRefs.has(ref.nativeId)) {
			throw new Error(`hermes session ${ref.nativeId} is closed`);
		}
		if (typeof content !== "string" || content.length === 0) {
			throw new Error("send: content must be a non-empty string");
		}

		return withRefLock(ref.nativeId, async () => {
			if (closedRefs.has(ref.nativeId)) {
				throw new Error(`hermes session ${ref.nativeId} is closed`);
			}
			const before = await readAllTurns(ref.nativeId).catch(() => []);
			const highWater =
				before.length === 0
					? -1
					: before.reduce((m, t) => (t.index > m ? t.index : m), -1);

			const args = [
				"chat",
				"-q",
				content,
				"--resume",
				ref.nativeId,
				"--pass-session-id",
				"--quiet",
				"--source",
				sourceTag,
			];

			const startedAt = Date.now();
			const result = await spawnFn({
				command: hermesBin,
				args,
				timeoutMs: sendTimeoutMs,
			});

			if (result.timedOut) {
				throw new Error(`send timed out after ${sendTimeoutMs}ms`);
			}
			if (result.exitCode !== 0) {
				const tail = tail500(result.stderr || result.stdout);
				const stderrLower = (result.stderr ?? "").toLowerCase();
				if (
					stderrLower.includes("not found") ||
					stderrLower.includes("no such session")
				) {
					throw new Error(`hermes session ${ref.nativeId} not found: ${tail}`);
				}
				throw new Error(
					`hermes exited with code ${result.exitCode ?? "(none)"}: ${tail}`,
				);
			}

			const after = await readAllTurns(ref.nativeId);
			const delta = after.filter((t) => t.index > highWater);
			const filtered = includeSystemTurns
				? delta
				: delta.filter((t) => t.role !== "system");
			const tokens = aggregateTokens(filtered);
			return {
				turns: filtered,
				tokens,
				durationMs: Date.now() - startedAt,
			};
		});
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
		capabilities: { resume: true, streaming: false },
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

function pushFlag(args: string[], key: string, value: unknown): void {
	const flag = `--${kebab(key)}`;
	if (typeof value === "boolean") {
		if (value) args.push(flag);
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) {
			args.push(flag, String(v));
		}
		return;
	}
	args.push(flag, String(value));
}

function kebab(name: string): string {
	return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
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
