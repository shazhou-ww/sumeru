import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	SpawnArgs,
	SpawnExitInfo,
	SpawnStreamResult,
	StreamingSpawnFn,
} from "../src/types.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

export function loadFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/** Outcome shape returned by the fake streaming spawn. */
export type FakeSpawnOutcome = {
	/** NDJSON text fed to the parser as async-iterable lines. */
	stdout?: string;
	exitCode?: number | null;
	signal?: NodeJS.Signals | null;
	timedOut?: boolean;
	durationMs?: number;
	stderr?: string;
};

export type FakeStreamingSpawnRecord = {
	calls: Array<SpawnArgs>;
	streamingSpawnFn: StreamingSpawnFn;
};

/** Yields each newline-delimited line of `text` as an async iterable. */
async function* linesFromText(text: string): AsyncGenerator<string> {
	for (const line of text.split("\n")) {
		yield line;
	}
}

/**
 * Test helper — build a `StreamingSpawnFn` that captures the args passed to it
 * and returns a canned `SpawnStreamResult`. Pass `outcome` to override fields;
 * defaults are a successful `ca-stream.simple.ndjson` run with no stderr and
 * exitCode 0.
 */
export function fakeStreamingSpawn(
	outcomes:
		| FakeSpawnOutcome
		| ((
				args: SpawnArgs,
				callIndex: number,
		  ) => FakeSpawnOutcome | Promise<FakeSpawnOutcome>),
): FakeStreamingSpawnRecord {
	const calls: Array<SpawnArgs> = [];
	const streamingSpawnFn: StreamingSpawnFn = (args) => {
		const callIndex = calls.length;
		calls.push(args);
		// Resolve synchronously when outcomes is a plain object; await inside
		// waitForExit's data path when it's a function.
		const outcomePromise =
			typeof outcomes === "function"
				? Promise.resolve(outcomes(args, callIndex))
				: Promise.resolve(outcomes);

		let resolved: FakeSpawnOutcome | null = null;
		let resolvedErr: unknown = null;
		let linesIterator: AsyncGenerator<string> | null = null;

		const ensureResolved = async (): Promise<FakeSpawnOutcome> => {
			if (resolvedErr !== null) {
				throw resolvedErr;
			}
			if (resolved === null) {
				try {
					resolved = await outcomePromise;
				} catch (err) {
					resolvedErr = err;
					throw err;
				}
			}
			return resolved;
		};

		const result: SpawnStreamResult = {
			lines: {
				[Symbol.asyncIterator]() {
					return {
						async next() {
							if (linesIterator === null) {
								const o = await ensureResolved();
								linesIterator = linesFromText(
									o.stdout ?? loadFixture("ca-stream.simple.ndjson"),
								);
							}
							return linesIterator.next();
						},
					};
				},
			},
			async waitForExit(): Promise<SpawnExitInfo> {
				const o = await ensureResolved();
				return {
					exitCode: o.exitCode ?? 0,
					signal: o.signal ?? null,
					timedOut: o.timedOut ?? false,
					durationMs: o.durationMs ?? 5,
					stderr: o.stderr ?? "",
				};
			},
		};
		return result;
	};
	return { calls, streamingSpawnFn };
}

/**
 * Build NDJSON output with a custom session id and assistant text. Useful when
 * tests need a specific id (e.g. resume with the original id).
 */
export function buildNdjson(opts: {
	sessionId: string;
	model?: string;
	userText?: string;
	assistantText?: string;
	subtype?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
}): string {
	const sessionId = opts.sessionId;
	const model = opts.model ?? "claude-sonnet-4";
	const userText = opts.userText ?? "hi";
	const assistantText = opts.assistantText ?? "ok";
	const subtype = opts.subtype ?? "success";
	const usage = opts.usage ?? {
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	const lines: string[] = [
		JSON.stringify({
			type: "system",
			subtype: "init",
			session_id: sessionId,
			model,
			cwd: "/tmp/work",
			permissionMode: "force",
		}),
		JSON.stringify({
			type: "user",
			message: { role: "user", content: [{ type: "text", text: userText }] },
		}),
		JSON.stringify({
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "text", text: assistantText }],
			},
		}),
		JSON.stringify({
			type: "result",
			subtype,
			duration_ms: 1234,
			result: assistantText,
			usage,
			request_id: "req_test",
		}),
	];
	return `${lines.join("\n")}\n`;
}
