import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import {
	parseStreamJson,
	parseStreamJsonIncremental,
} from "../src/stream-parser.js";
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

describe("incremental streaming — adapter-cursor-agent", () => {
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

		const adapter = createCursorAgentAdapter({ spawnFn, streamingSpawnFn });
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
		const ndjsonLines = [
			JSON.stringify({
				type: "system",
				subtype: "init",
				session_id: "sess-cache-mid",
				model: "claude-sonnet-4",
				cwd: "/tmp/work",
				permissionMode: "force",
			}),
			JSON.stringify({
				type: "user",
				message: { role: "user", content: [{ type: "text", text: "msg" }] },
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "first response" }],
				},
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "second response" }],
				},
			}),
			JSON.stringify({
				type: "result",
				subtype: "success",
				duration_ms: 100,
				result: "second response",
				usage: { inputTokens: 10, outputTokens: 5 },
			}),
		];

		const { streamingSpawnFn } = createMockStreamingSpawn(ndjsonLines, 200);
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-cache-mid" }),
		});

		const adapter = createCursorAgentAdapter({ spawnFn, streamingSpawnFn });
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
		const ndjsonLines = [
			JSON.stringify({
				type: "system",
				subtype: "init",
				session_id: "sess-err",
				model: "claude-sonnet-4",
				cwd: "/tmp/work",
				permissionMode: "force",
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "partial" }],
				},
			}),
		];

		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-err" }),
		});

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

		const adapter = createCursorAgentAdapter({ spawnFn, streamingSpawnFn });
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

	it("tool_call completed fills output on previously-yielded Turn via reference sharing", async () => {
		const callId = "call_abc123";
		const ndjsonLines = [
			JSON.stringify({
				type: "system",
				subtype: "init",
				session_id: "sess-toolcall",
				model: "claude-sonnet-4",
				cwd: "/tmp/work",
				permissionMode: "force",
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Let me run a command" }],
				},
			}),
			JSON.stringify({
				type: "tool_call",
				subtype: "started",
				call_id: callId,
				tool_call: {
					shellToolCall: { args: { command: "ls" } },
				},
			}),
			JSON.stringify({
				type: "tool_call",
				subtype: "completed",
				call_id: callId,
				tool_call: {
					shellToolCall: { result: { stdout: "file.txt", exitCode: 0 } },
				},
			}),
			JSON.stringify({
				type: "result",
				subtype: "success",
				duration_ms: 100,
				result: "done",
				usage: { inputTokens: 10, outputTokens: 5 },
			}),
		];

		const { streamingSpawnFn } = createMockStreamingSpawn(ndjsonLines, 200);
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-toolcall" }),
		});

		const adapter = createCursorAgentAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const _events = await collectEvents(adapter.send(ref, "run ls"));

		// After stream completes, the turn in cache should have tool output filled in
		const cached = await adapter.getTurns(ref);
		const assistantTurn = cached.find(
			(t) => t.content === "Let me run a command",
		);
		expect(assistantTurn).toBeDefined();
		expect(assistantTurn?.toolCalls).not.toBeNull();
		expect(assistantTurn?.toolCalls?.[0]?.output).toBe("file.txt");
		expect(assistantTurn?.toolCalls?.[0]?.exitCode).toBe(0);
	});

	it("incremental parser equivalence — same output as batch parser", async () => {
		const ndjson = buildNdjson({
			sessionId: "sess-equiv",
			userText: "hello world",
			assistantText: "goodbye world",
			usage: { inputTokens: 50, outputTokens: 25 },
		});

		const batchResult = parseStreamJson(ndjson);
		expect(batchResult).not.toBeNull();
		const batchTurns = batchResult?.turns ?? [];

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

		expect(incrementalTurns.length).toBe(batchTurns.length);
		for (let i = 0; i < batchTurns.length; i++) {
			expect(incrementalTurns[i]?.role).toBe(batchTurns[i]?.role);
			expect(incrementalTurns[i]?.content).toBe(batchTurns[i]?.content);
			expect(incrementalTurns[i]?.index).toBe(batchTurns[i]?.index);
		}
	});
});
