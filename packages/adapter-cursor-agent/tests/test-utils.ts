import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SpawnArgs, SpawnFn, SpawnResult } from "../src/types.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

export function loadFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/**
 * Test helper — build a `SpawnFn` that captures the args passed to it and
 * returns a canned result. Pass `result` to override fields; defaults are a
 * successful `ca-stream.simple.ndjson` run with no stderr and exitCode 0.
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
			stdout: partial.stdout ?? loadFixture("ca-stream.simple.ndjson"),
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
