import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import {
	parseCodexJson,
	parseCodexJsonIncremental,
} from "../src/stream-parser.js";
import {
	buildJsonl,
	createMockStreamingSpawn,
	fakeSpawn,
} from "./test-utils.js";

/** Collect all events from an AsyncIterable<SendEvent>. */
async function collectEvents(
	iter: AsyncIterable<SendEvent>,
): Promise<SendEvent[]> {
	const events: SendEvent[] = [];
	for await (const event of iter) {
		events.push(event);
	}
	return events;
}

describe("incremental streaming — adapter-codex", () => {
	it("turns are yielded BEFORE the process exits", async () => {
		const jsonlLines = buildJsonl({
			sessionId: "sess-timing",
			userText: "prompt",
			assistantText: "response text",
		})
			.split("\n")
			.filter((l) => l.trim() !== "");

		const { streamingSpawnFn, isExited } = createMockStreamingSpawn(
			jsonlLines,
			200,
		);

		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-timing" }),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const exitedAtEvent: boolean[] = [];
		for await (const event of adapter.send(ref, "prompt")) {
			exitedAtEvent.push(isExited());
			if (event.type === "turn") {
				expect(isExited()).toBe(false);
			}
			if (event.type === "done") {
				expect(isExited()).toBe(true);
			}
		}

		expect(exitedAtEvent.length).toBeGreaterThanOrEqual(2);
	});

	it("turnsCache is updated mid-stream", async () => {
		const jsonlLines = [
			JSON.stringify({
				type: "session.start",
				session_id: "sess-cache-mid",
				model: "o3",
				cwd: "/tmp/work",
			}),
			JSON.stringify({
				type: "user",
				role: "user",
				content: "msg",
			}),
			JSON.stringify({
				type: "assistant",
				role: "assistant",
				content: "first response",
			}),
			JSON.stringify({
				type: "assistant",
				role: "assistant",
				content: "second response",
			}),
			JSON.stringify({
				type: "result",
				subtype: "success",
				session_id: "sess-cache-mid",
				duration_ms: 100,
				usage: { input_tokens: 10, output_tokens: 5 },
			}),
		];

		const { streamingSpawnFn } = createMockStreamingSpawn(jsonlLines, 200);
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-cache-mid" }),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const initialTurns = await adapter.getTurns(ref);
		const initialCount = initialTurns.length;

		let firstTurnSeen = false;
		for await (const event of adapter.send(ref, "msg")) {
			if (event.type === "turn" && !firstTurnSeen) {
				firstTurnSeen = true;
				const midTurns = await adapter.getTurns(ref);
				expect(midTurns.length).toBeGreaterThan(initialCount);
			}
		}

		const finalTurns = await adapter.getTurns(ref);
		expect(finalTurns.length).toBeGreaterThan(initialCount + 1);
	});

	it("error mid-stream preserves already-yielded turns", async () => {
		const jsonlLines = [
			JSON.stringify({
				type: "session.start",
				session_id: "sess-err",
				model: "o3",
				cwd: "/tmp/work",
			}),
			JSON.stringify({
				type: "assistant",
				role: "assistant",
				content: "partial",
			}),
		];

		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-err" }),
		});

		const streamingSpawnFn = () => {
			const lines: AsyncIterable<string> = (async function* () {
				for (const line of jsonlLines) {
					yield line;
					await new Promise<void>((r) => setTimeout(r, 10));
				}
			})();

			return {
				lines,
				waitForExit: async () => ({
					exitCode: 1 as number | null,
					signal: null as NodeJS.Signals | null,
					timedOut: false,
					durationMs: 50,
					stderr: "error: something went wrong",
				}),
			};
		};

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const events = await collectEvents(adapter.send(ref, "msg"));
		const turnEvents = events.filter((e) => e.type === "turn");
		const errorEvents = events.filter((e) => e.type === "error");

		expect(turnEvents.length).toBeGreaterThanOrEqual(1);
		expect(errorEvents.length).toBe(1);

		const cached = await adapter.getTurns(ref);
		const sendTurns = cached.filter((t) => t.content === "partial");
		expect(sendTurns.length).toBe(1);
	});

	it("tool output events fill in ToolCall.output on previously-yielded Turn", async () => {
		const toolCallId = "tc_abc123";
		const jsonlLines = [
			JSON.stringify({
				type: "session.start",
				session_id: "sess-tool",
				model: "o3",
			}),
			JSON.stringify({
				type: "assistant",
				role: "assistant",
				content: "Let me check",
				tool_calls: [
					{
						id: toolCallId,
						function: { name: "run_shell", arguments: '{"command":"ls"}' },
					},
				],
			}),
			JSON.stringify({
				type: "tool_call_output",
				tool_call_id: toolCallId,
				output: "file1.txt\nfile2.txt",
			}),
			JSON.stringify({
				type: "result",
				subtype: "success",
				session_id: "sess-tool",
				duration_ms: 100,
				usage: { input_tokens: 10, output_tokens: 5 },
			}),
		];

		const { streamingSpawnFn } = createMockStreamingSpawn(jsonlLines, 200);
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-tool" }),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		await collectEvents(adapter.send(ref, "run ls"));

		const cached = await adapter.getTurns(ref);
		const assistantTurn = cached.find((t) => t.content === "Let me check");
		expect(assistantTurn).toBeDefined();
		expect(assistantTurn?.toolCalls).not.toBeNull();
		expect(assistantTurn?.toolCalls?.[0]?.output).toBe("file1.txt\nfile2.txt");
	});

	it("incremental parser equivalence — same output as batch parser", async () => {
		const jsonl = buildJsonl({
			sessionId: "sess-equiv",
			userText: "hello world",
			assistantText: "goodbye world",
			usage: { input_tokens: 50, output_tokens: 25 },
		});

		const batchResult = parseCodexJson(jsonl);
		expect(batchResult).not.toBeNull();
		const batchTurns = batchResult?.turns ?? [];

		const lines = jsonl.split("\n").filter((l) => l.trim() !== "");
		async function* generateLines(): AsyncGenerator<string> {
			for (const line of lines) {
				yield line;
			}
		}

		const incrementalTurns: typeof batchTurns = [];
		for await (const event of parseCodexJsonIncremental(generateLines())) {
			if (event.type === "turn") {
				incrementalTurns.push(event.turn);
			}
		}

		expect(incrementalTurns.length).toBe(batchTurns.length);
		for (let i = 0; i < batchTurns.length; i++) {
			expect(incrementalTurns[i]?.role).toBe(batchTurns[i]?.role);
			expect(incrementalTurns[i]?.content).toBe(batchTurns[i]?.content);
			expect(incrementalTurns[i]?.index).toBe(batchTurns[i]?.index);
		}
	});
});
