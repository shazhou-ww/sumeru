/**
 * Issue #32 — direct factory tests verifying `createClaudeCodeAdapter`
 * accepts the timeout / max-turn options from `sumeru.yaml`'s gateway
 * `config:` blob, and that the default `sendTimeoutMs` is now 30 minutes.
 */

import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn, fakeStreamingSpawn } from "./test-utils.js";

/** Drain the iterable to force the full stream to execute. */
async function drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// consume all events
	}
}

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

/** Extract the error event from collected events. */
function extractError(
	events: SendEvent[],
): Extract<SendEvent, { type: "error" }> | undefined {
	return events.find(
		(e): e is Extract<SendEvent, { type: "error" }> => e.type === "error",
	);
}

describe("createClaudeCodeAdapter — options forwarded from sumeru.yaml (issue #32)", () => {
	it("uses operator-supplied timeouts and maxTurns for both createSession and send", async () => {
		const { calls: spawnCalls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-config" }),
		});
		const { calls: streamCalls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-config",
				userText: "hello",
				assistantText: "world",
			}),
		});
		const adapter = createClaudeCodeAdapter({
			sendTimeoutMs: 1_800_000,
			createSessionTimeoutMs: 300_000,
			maxTurns: 120,
			spawnFn,
			streamingSpawnFn,
		});
		const ref = await adapter.createSession({ model: null, cwd: null });
		await drain(adapter.send(ref, "hello"));

		expect(spawnCalls.length).toBe(1);
		expect(streamCalls.length).toBe(1);
		// createSession spawn carries the operator's createSessionTimeoutMs.
		expect(spawnCalls[0]?.timeoutMs).toBe(300_000);
		// send spawn carries the operator's sendTimeoutMs.
		expect(streamCalls[0]?.timeoutMs).toBe(1_800_000);
		// --max-turns is the operator's value.
		const maxTurnsIdx = spawnCalls[0]?.args.indexOf("--max-turns") ?? -1;
		expect(spawnCalls[0]?.args[maxTurnsIdx + 1]).toBe("120");
		const maxTurnsIdx2 = streamCalls[0]?.args.indexOf("--max-turns") ?? -1;
		expect(streamCalls[0]?.args[maxTurnsIdx2 + 1]).toBe("120");
	});

	it("default factory uses 30-min sendTimeout and 5-min createTimeout", async () => {
		const { calls: spawnCalls, spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-default" }),
		});
		const { calls: streamCalls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-default",
				userText: "hi",
				assistantText: "ok",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await drain(adapter.send(ref, "hi"));

		expect(spawnCalls.length).toBe(1);
		expect(streamCalls.length).toBe(1);
		expect(spawnCalls[0]?.timeoutMs).toBe(5 * 60_000);
		// 30 min — the new default introduced by issue #32 (was 10 min).
		expect(streamCalls[0]?.timeoutMs).toBe(30 * 60_000);
	});

	it("send timeout yields error event with the operator-configured value", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-timeout-msg" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			streamingSpawnFn,
			sendTimeoutMs: 1_800_000,
		});
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "x"));
		const error = extractError(events);
		expect(error).toBeDefined();
		expect(error?.error.message).toMatch(/send timed out after 1800000ms/);
	});

	it("createSession timeout error message reports the operator-configured value", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			createSessionTimeoutMs: 300_000,
		});
		await expect(
			adapter.createSession({ model: null, cwd: null }),
		).rejects.toThrow(/createSession timed out after 300000ms/);
	});
});
