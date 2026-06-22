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
	loadFixture,
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
				type: "thread.started",
				thread_id: "sess-cache-mid",
			}),
			JSON.stringify({
				type: "turn.started",
			}),
			JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_0",
					type: "agent_message",
					text: "first response",
				},
			}),
			JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_1",
					type: "agent_message",
					text: "second response",
				},
			}),
			JSON.stringify({
				type: "turn.completed",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cached_input_tokens: 0,
					reasoning_output_tokens: 0,
				},
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
				type: "thread.started",
				thread_id: "sess-err",
			}),
			JSON.stringify({
				type: "turn.started",
			}),
			JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_0",
					type: "agent_message",
					text: "partial",
				},
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

	it("incremental parser equivalence — same output as batch parser", async () => {
		const jsonl = buildJsonl({
			sessionId: "sess-equiv",
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

	it("incremental parser — meta event fires on thread.started", async () => {
		const lines = loadFixture("codex-stream.success.jsonl")
			.split("\n")
			.filter((l) => l.trim() !== "");
		async function* generateLines(): AsyncGenerator<string> {
			for (const line of lines) {
				yield line;
			}
		}

		const events: Array<{ type: string }> = [];
		for await (const event of parseCodexJsonIncremental(generateLines())) {
			events.push(event);
		}

		// First event should be "meta"
		expect(events[0]?.type).toBe("meta");
		const meta = events[0] as {
			type: "meta";
			sessionId: string;
			model: string;
		};
		expect(meta.sessionId).toBe("019eee31-d98e-7dc1-a198-59e59cd58310");
		expect(meta.model).toBe("");
	});

	it("incremental parser — item.started events do NOT yield turns", async () => {
		const lines = loadFixture("codex-stream.success.jsonl")
			.split("\n")
			.filter((l) => l.trim() !== "");
		async function* generateLines(): AsyncGenerator<string> {
			for (const line of lines) {
				yield line;
			}
		}

		const turnEvents: Array<{ type: "turn" }> = [];
		for await (const event of parseCodexJsonIncremental(generateLines())) {
			if (event.type === "turn") {
				turnEvents.push(event);
			}
		}

		// 3 item.completed events → 3 turns (item.started doesn't produce a turn)
		expect(turnEvents.length).toBe(3);
	});

	it("incremental parser — malformed lines mid-stream do not crash", async () => {
		const lines = loadFixture("codex-stream.malformed.jsonl")
			.split("\n")
			.filter((l) => l.trim() !== "");
		async function* generateLines(): AsyncGenerator<string> {
			for (const line of lines) {
				yield line;
			}
		}

		const events: Array<{ type: string }> = [];
		for await (const event of parseCodexJsonIncremental(generateLines())) {
			events.push(event);
		}

		// Should not throw — produces meta + 1 turn + result
		expect(events.length).toBe(3);
		expect(events[0]?.type).toBe("meta");
		expect(events[1]?.type).toBe("turn");
		expect(events[2]?.type).toBe("result");
	});

	it("incremental parser — empty async iterable yields no events", async () => {
		async function* generateLines(): AsyncGenerator<string> {
			// empty
		}

		const events: Array<{ type: string }> = [];
		for await (const event of parseCodexJsonIncremental(generateLines())) {
			events.push(event);
		}

		expect(events.length).toBe(0);
	});

	it("incremental parser — result event yields turn.completed line", async () => {
		const lines = loadFixture("codex-stream.simple.jsonl")
			.split("\n")
			.filter((l) => l.trim() !== "");
		async function* generateLines(): AsyncGenerator<string> {
			for (const line of lines) {
				yield line;
			}
		}

		let resultEvent: {
			type: "result";
			resultLine: Record<string, unknown>;
		} | null = null;
		for await (const event of parseCodexJsonIncremental(generateLines())) {
			if (event.type === "result") {
				resultEvent = event;
			}
		}

		expect(resultEvent).not.toBeNull();
		const usage = resultEvent?.resultLine.usage as Record<string, unknown>;
		expect(usage.input_tokens).toBe(8774);
		expect(usage.output_tokens).toBe(5);
	});

	it("command_execution with tool call produces correct Turn shape", async () => {
		const jsonl = buildJsonl({
			sessionId: "sess-cmd",
			assistantText: "Let me run that",
			commandExecution: {
				command: '/bin/bash -lc "ls -la"',
				output: "total 0\n",
				exitCode: 0,
			},
		});

		const result = parseCodexJson(jsonl);
		expect(result).not.toBeNull();
		expect(result?.numTurns).toBe(2); // agent_message + command_execution

		const cmdTurn = result?.turns[1];
		expect(cmdTurn?.role).toBe("assistant");
		expect(cmdTurn?.content).toBe("");
		expect(cmdTurn?.toolCalls).not.toBeNull();
		expect(cmdTurn?.toolCalls?.[0]?.tool).toBe("command_execution");
		expect(cmdTurn?.toolCalls?.[0]?.input).toEqual({
			command: '/bin/bash -lc "ls -la"',
		});
		expect(cmdTurn?.toolCalls?.[0]?.output).toBe("total 0\n");
		expect(cmdTurn?.toolCalls?.[0]?.exitCode).toBe(0);
	});
});
