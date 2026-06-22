import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	SpawnArgs,
	SpawnExitInfo,
	SpawnFn,
	SpawnResult,
	SpawnStreamResult,
	StreamingSpawnFn,
} from "../src/types.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

export function loadFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/**
 * Test helper — build a `SpawnFn` that captures the args passed to it and
 * returns a canned result. Pass `result` to override fields; defaults are a
 * successful `codex-stream.success.jsonl` run with no stderr and exitCode 0.
 */
export type FakeSpawnRecord = {
	calls: Array<SpawnArgs>;
	spawnFn: SpawnFn;
};

export function fakeSpawn(
	results:
		| Partial<SpawnResult>
		| ((
				args: SpawnArgs,
				callIndex: number,
		  ) => Partial<SpawnResult> | Promise<Partial<SpawnResult>>),
): FakeSpawnRecord {
	const calls: Array<SpawnArgs> = [];
	const spawnFn: SpawnFn = async (args) => {
		const callIndex = calls.length;
		calls.push(args);
		const partial =
			typeof results === "function" ? await results(args, callIndex) : results;
		return {
			stdout: partial.stdout ?? loadFixture("codex-stream.success.jsonl"),
			stderr: partial.stderr ?? "",
			exitCode: partial.exitCode ?? 0,
			signal: partial.signal ?? null,
			timedOut: partial.timedOut ?? false,
			durationMs: partial.durationMs ?? 5,
		};
	};
	return { calls, spawnFn };
}

/**
 * Test helper — build a `StreamingSpawnFn` that yields lines from the given
 * JSONL string (one line per iteration) and then resolves exit info.
 */
export type FakeStreamingSpawnRecord = {
	calls: Array<SpawnArgs>;
	streamingSpawnFn: StreamingSpawnFn;
};

export function fakeStreamingSpawn(
	results:
		| Partial<SpawnResult>
		| ((
				args: SpawnArgs,
				callIndex: number,
		  ) => Partial<SpawnResult> | Promise<Partial<SpawnResult>>),
): FakeStreamingSpawnRecord {
	const calls: Array<SpawnArgs> = [];
	const streamingSpawnFn: StreamingSpawnFn = (args) => {
		const callIndex = calls.length;
		calls.push(args);

		let resolvePartial: (val: Partial<SpawnResult>) => void;
		const partialPromise = new Promise<Partial<SpawnResult>>((resolve) => {
			resolvePartial = resolve;
		});

		const rawResult =
			typeof results === "function" ? results(args, callIndex) : results;
		if (rawResult instanceof Promise) {
			rawResult.then((r) => resolvePartial(r));
		} else {
			resolvePartial(rawResult);
		}

		const lines: AsyncIterable<string> = {
			[Symbol.asyncIterator]() {
				let started = false;
				let lineArray: string[] = [];
				let lineIndex = 0;

				return {
					async next() {
						if (!started) {
							started = true;
							const partial = await partialPromise;
							const stdout =
								partial.stdout ?? loadFixture("codex-stream.success.jsonl");
							lineArray = stdout.split("\n").filter((l) => l.trim() !== "");
						}
						if (lineIndex < lineArray.length) {
							return { done: false, value: lineArray[lineIndex++] as string };
						}
						return { done: true, value: undefined };
					},
				};
			},
		};

		const waitForExit = async (): Promise<SpawnExitInfo> => {
			const partial = await partialPromise;
			return {
				exitCode: partial.exitCode ?? 0,
				signal: partial.signal ?? null,
				timedOut: partial.timedOut ?? false,
				durationMs: partial.durationMs ?? 5,
				stderr: partial.stderr ?? "",
			};
		};

		return { lines, waitForExit };
	};
	return { calls, streamingSpawnFn };
}

/**
 * Build a mock StreamingSpawnFn with explicit timing control for incremental
 * streaming tests.
 */
export function createMockStreamingSpawn(
	jsonlLines: string[],
	exitDelayMs: number,
): { streamingSpawnFn: StreamingSpawnFn; isExited: () => boolean } {
	let exited = false;

	const streamingSpawnFn: StreamingSpawnFn = (): SpawnStreamResult => {
		let exitResolve: (info: SpawnExitInfo) => void;
		const exitPromise = new Promise<SpawnExitInfo>((resolve) => {
			exitResolve = resolve;
		});

		const lines: AsyncIterable<string> = (async function* () {
			for (const line of jsonlLines) {
				yield line;
				await new Promise<void>((r) => setTimeout(r, 10));
			}
			setTimeout(() => {
				exited = true;
				exitResolve({
					exitCode: 0,
					signal: null,
					timedOut: false,
					durationMs: 100,
					stderr: "",
				});
			}, exitDelayMs);
		})();

		return { lines, waitForExit: () => exitPromise };
	};

	return { streamingSpawnFn, isExited: () => exited };
}

/**
 * Build JSONL output using the real Codex v0.141.0 event schema.
 * Produces: thread.started → turn.started → item.completed(agent_message) → turn.completed
 * Optionally includes a command_execution item if `commandExecution` is provided.
 */
export function buildJsonl(opts: {
	sessionId: string;
	assistantText?: string;
	commandExecution?: {
		command: string;
		output: string;
		exitCode: number;
	};
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cached_input_tokens?: number;
		reasoning_output_tokens?: number;
	};
}): string {
	const sessionId = opts.sessionId;
	const assistantText = opts.assistantText ?? "ok";
	const usage = opts.usage ?? {
		input_tokens: 10,
		output_tokens: 5,
		cached_input_tokens: 0,
		reasoning_output_tokens: 0,
	};
	const lines: string[] = [
		JSON.stringify({
			type: "thread.started",
			thread_id: sessionId,
		}),
		JSON.stringify({
			type: "turn.started",
		}),
		JSON.stringify({
			type: "item.completed",
			item: {
				id: "item_0",
				type: "agent_message",
				text: assistantText,
			},
		}),
	];

	if (opts.commandExecution !== undefined) {
		const cmd = opts.commandExecution;
		lines.push(
			JSON.stringify({
				type: "item.started",
				item: {
					id: "item_1",
					type: "command_execution",
					command: cmd.command,
					aggregated_output: "",
					exit_code: null,
					status: "in_progress",
				},
			}),
		);
		lines.push(
			JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_1",
					type: "command_execution",
					command: cmd.command,
					aggregated_output: cmd.output,
					exit_code: cmd.exitCode,
					status: "completed",
				},
			}),
		);
	}

	lines.push(
		JSON.stringify({
			type: "turn.completed",
			usage: {
				input_tokens: usage.input_tokens ?? 10,
				output_tokens: usage.output_tokens ?? 5,
				cached_input_tokens: usage.cached_input_tokens ?? 0,
				reasoning_output_tokens: usage.reasoning_output_tokens ?? 0,
			},
		}),
	);

	return `${lines.join("\n")}\n`;
}
