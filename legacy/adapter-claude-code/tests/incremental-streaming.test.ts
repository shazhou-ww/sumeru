import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import {
	createClaudeCodeAdapter,
	parseStreamJson,
	parseStreamJsonIncremental,
} from "../src/index.js";
import {
	buildNdjson,
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

describe("incremental streaming — adapter-claude-code", () => {
	it("turns are yielded BEFORE the process exits", async () => {
		const ndjsonLines = buildNdjson({
			sessionId: "sess-timing",
			userText: "prompt",
			assistantText: "response text",
		})
			.split("\n")
			.filter((l) => l.trim() !== "");

		const { streamingSpawnFn, isExited } = createMockStreamingSpawn(
			ndjsonLines,
			200,
		);

		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-timing" }),
		});

		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const exitedAtEvent: boolean[] = [];
		for await (const event of adapter.send(ref, "prompt")) {
			exitedAtEvent.push(isExited());
			if (event.type === "turn") {
				// Turns should arrive BEFORE exit
				expect(isExited()).toBe(false);
			}
			if (event.type === "done") {
				// Done should arrive AFTER exit
				expect(isExited()).toBe(true);
			}
		}

		// At least one turn event + done event
		expect(exitedAtEvent.length).toBeGreaterThanOrEqual(2);
	});

	it("turnsCache is updated mid-stream", async () => {
		const ndjsonLines = [
			JSON.stringify({
				type: "system",
				subtype: "init",
				session_id: "sess-cache-mid",
				model: "claude-sonnet-4-5",
				cwd: "/tmp/work",
			}),
			JSON.stringify({
				type: "user",
				message: { role: "user", content: [{ type: "text", text: "msg" }] },
				session_id: "sess-cache-mid",
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					id: "msg_1",
					role: "assistant",
					content: [{ type: "text", text: "first response" }],
				},
				session_id: "sess-cache-mid",
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					id: "msg_2",
					role: "assistant",
					content: [{ type: "text", text: "second response" }],
				},
				session_id: "sess-cache-mid",
			}),
			JSON.stringify({
				type: "result",
				subtype: "success",
				duration_ms: 100,
				result: "second response",
				session_id: "sess-cache-mid",
				usage: { input_tokens: 10, output_tokens: 5 },
			}),
		];

		const { streamingSpawnFn } = createMockStreamingSpawn(ndjsonLines, 200);
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-cache-mid" }),
		});

		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const initialTurns = await adapter.getTurns(ref);
		const initialCount = initialTurns.length;

		let firstTurnSeen = false;
		for await (const event of adapter.send(ref, "msg")) {
			if (event.type === "turn" && !firstTurnSeen) {
				firstTurnSeen = true;
				// After first turn event, getTurns should include it
				const midTurns = await adapter.getTurns(ref);
				expect(midTurns.length).toBeGreaterThan(initialCount);
			}
		}

		// After stream completes, all turns are in cache
		const finalTurns = await adapter.getTurns(ref);
		expect(finalTurns.length).toBeGreaterThan(initialCount + 1);
	});

	it("error mid-stream preserves already-yielded turns", async () => {
		const ndjsonLines = [
			JSON.stringify({
				type: "system",
				subtype: "init",
				session_id: "sess-err",
				model: "claude-sonnet-4-5",
				cwd: "/tmp/work",
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					id: "msg_1",
					role: "assistant",
					content: [{ type: "text", text: "partial" }],
				},
				session_id: "sess-err",
			}),
			// No result line — process exits with non-zero code
		];

		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-err" }),
		});

		// Custom mock that exits with error after yielding lines
		const streamingSpawnFn = () => {
			const lines: AsyncIterable<string> = (async function* () {
				for (const line of ndjsonLines) {
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

		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const events = await collectEvents(adapter.send(ref, "msg"));
		const turnEvents = events.filter((e) => e.type === "turn");
		const errorEvents = events.filter((e) => e.type === "error");

		// Should have yielded the partial turn
		expect(turnEvents.length).toBeGreaterThanOrEqual(1);
		// Should have an error event
		expect(errorEvents.length).toBe(1);

		// turnsCache should contain the partial turn
		const cached = await adapter.getTurns(ref);
		const sendTurns = cached.filter((t) => t.content === "partial");
		expect(sendTurns.length).toBe(1);
	});

	it("incremental parser equivalence — same output as batch parser", async () => {
		const ndjson = buildNdjson({
			sessionId: "sess-equiv",
			userText: "hello world",
			assistantText: "goodbye world",
			usage: { input_tokens: 50, output_tokens: 25 },
		});

		// Batch parse
		const batchResult = parseStreamJson(ndjson);
		expect(batchResult).not.toBeNull();
		const batchTurns = batchResult?.turns ?? [];

		// Incremental parse — collect all turn events
		const lines = ndjson.split("\n").filter((l) => l.trim() !== "");
		async function* generateLines(): AsyncGenerator<string> {
			for (const line of lines) {
				yield line;
			}
		}

		const incrementalTurns: typeof batchTurns = [];
		for await (const event of parseStreamJsonIncremental(generateLines())) {
			if (event.type === "turn") {
				incrementalTurns.push(event.turn);
			}
		}

		// Same number of turns
		expect(incrementalTurns.length).toBe(batchTurns.length);

		// Same content and role for each turn
		for (let i = 0; i < batchTurns.length; i++) {
			expect(incrementalTurns[i]?.role).toBe(batchTurns[i]?.role);
			expect(incrementalTurns[i]?.content).toBe(batchTurns[i]?.content);
			expect(incrementalTurns[i]?.index).toBe(batchTurns[i]?.index);
		}
	});
});
