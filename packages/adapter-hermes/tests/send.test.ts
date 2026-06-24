import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendEvent, Turn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import type { SpawnArgs, SpawnFn, TurnsReader } from "../src/index.js";
import { createHermesAdapter } from "../src/index.js";

const NATIVE = "20260613_120000_aaaaaa";

function ref() {
	return { nativeId: NATIVE, meta: {} };
}

function turn(index: number, role: Turn["role"], content: string): Turn {
	return {
		index,
		role,
		content,
		timestamp: "2026-06-13T12:00:00.000Z",
		toolCalls: null,
	};
}

function makeSpawn(
	opts: { exitCode?: number; stderr?: string; timedOut?: boolean } = {},
): SpawnFn {
	return async () => ({
		stdout: "",
		stderr: opts.stderr ?? "",
		exitCode: opts.exitCode ?? 0,
		signal: null,
		timedOut: opts.timedOut ?? false,
		durationMs: 0,
	});
}

/**
 * Capturing spawn — records the `SpawnArgs` of each call (including the new
 * `cwd` field) so the #66 resume-cwd cases can assert what was forwarded to
 * `child_process.spawn`.
 */
function captureSpawn(): { calls: SpawnArgs[]; spawnFn: SpawnFn } {
	const calls: SpawnArgs[] = [];
	const spawnFn: SpawnFn = async (args) => {
		calls.push(args);
		return {
			stdout: "",
			stderr: "",
			exitCode: 0,
			signal: null,
			timedOut: false,
			durationMs: 0,
		};
	};
	return { calls, spawnFn };
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

/** Extract turns from collected events. */
function extractTurns(events: SendEvent[]): Turn[] {
	return events
		.filter((e): e is Extract<SendEvent, { type: "turn" }> => e.type === "turn")
		.map((e) => e.turn);
}

/** Extract the done event from collected events. */
function extractDone(
	events: SendEvent[],
): Extract<SendEvent, { type: "done" }> | undefined {
	return events.find(
		(e): e is Extract<SendEvent, { type: "done" }> => e.type === "done",
	);
}

/** Extract the error event from collected events. */
function extractError(
	events: SendEvent[],
): Extract<SendEvent, { type: "error" }> | undefined {
	return events.find(
		(e): e is Extract<SendEvent, { type: "error" }> => e.type === "error",
	);
}

/** Extract the suspend event from collected events. */
function extractSuspend(
	events: SendEvent[],
): Extract<SendEvent, { type: "suspend" }> | undefined {
	return events.find(
		(e): e is Extract<SendEvent, { type: "suspend" }> => e.type === "suspend",
	);
}

/** Drain the iterable to force the full stream to execute. */
async function drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// consume all events
	}
}

describe("@sumeru/adapter-hermes — send", () => {
	it("yields delta turn events followed by a done event", async () => {
		const reads: number[] = [];
		const turnsReader: TurnsReader = async () => {
			reads.push(reads.length);
			if (reads.length === 1) return [turn(0, "user", "old")];
			return [
				turn(0, "user", "old"),
				turn(1, "user", "what?"),
				turn(2, "assistant", "answer"),
			];
		};
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn(),
			turnsReader,
		});
		const events = await collectEvents(adapter.send(ref(), "what?"));
		const turns = extractTurns(events);
		const done = extractDone(events);
		expect(turns.map((t) => t.index)).toEqual([1, 2]);
		expect(turns[0].role).toBe("user");
		expect(turns[1].role).toBe("assistant");
		expect(done).toBeDefined();
		expect(typeof done?.durationMs).toBe("number");
	});

	it("filters system turns by default", async () => {
		const calls: number[] = [];
		const turnsReader: TurnsReader = async () => {
			calls.push(calls.length);
			if (calls.length === 1) return [];
			return [
				turn(0, "user", "u"),
				turn(1, "system", "s"),
				turn(2, "assistant", "a"),
			];
		};
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn(),
			turnsReader,
		});
		const events = await collectEvents(adapter.send(ref(), "go"));
		const turns = extractTurns(events);
		expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
	});

	it("invokes hermes with --resume <id> and --quiet --pass-session-id", async () => {
		let captured: string[] = [];
		const spawnFn: SpawnFn = async (a) => {
			captured = a.args;
			return {
				stdout: "",
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 0,
			};
		};
		const turnsReader: TurnsReader = async () => [];
		const adapter = createHermesAdapter({ spawnFn, turnsReader });
		await drain(adapter.send(ref(), "ping"));
		expect(captured[0]).toBe("chat");
		expect(captured).toContain("--resume");
		const idx = captured.indexOf("--resume");
		expect(captured[idx + 1]).toBe(NATIVE);
		expect(captured).toContain("--pass-session-id");
		expect(captured).toContain("--quiet");
		expect(captured).toContain("--source");
		// content is passed as argv (not shell)
		expect(captured).toContain("ping");
	});

	// ── cwd pinning on resume (issue #66) ──

	it("pins SpawnArgs.cwd to ref.meta.cwd on resume", async () => {
		const { calls, spawnFn } = captureSpawn();
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: async () => [],
		});
		const pinnedRef = {
			nativeId: NATIVE,
			meta: {
				cwd: "/srv/projects/x",
				sourceTag: "sumeru",
				model: null,
				createdAt: "2026-06-13T12:00:00.000Z",
			},
		};
		await drain(adapter.send(pinnedRef, "My favorite number is 42."));
		expect(calls.length).toBe(1);
		expect(calls[0]?.cwd).toBe("/srv/projects/x");
		// cwd is NOT a CLI flag.
		expect(calls[0]?.args).not.toContain("--cwd");
	});

	it("falls back to process.cwd() when ref.meta.cwd is absent (legacy meta: {})", async () => {
		const { calls, spawnFn } = captureSpawn();
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: async () => [],
		});
		await drain(adapter.send(ref(), "hi"));
		expect(calls[0]?.cwd).toBe(process.cwd());
	});

	it("throws synchronously after close with 'is closed'", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn(),
			turnsReader: async () => [],
		});
		const r = ref();
		await adapter.close(r);
		expect(() => adapter.send(r, "hi")).toThrow(/is closed/);
	});

	it("yields error event on non-zero hermes exit with stderr tail", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn({ exitCode: 1, stderr: "session not found" }),
			turnsReader: async () => [],
		});
		const events = await collectEvents(adapter.send(ref(), "hi"));
		const error = extractError(events);
		expect(error).toBeDefined();
		expect(error?.error.message).toMatch(/not found/);
	});

	it("yields suspend event on timeout", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn({ timedOut: true }),
			turnsReader: async () => [],
			sendTimeoutMs: 50,
		});
		const sessionRef = ref();
		const events = await collectEvents(adapter.send(sessionRef, "hi"));
		const suspend = extractSuspend(events);
		expect(suspend).toBeDefined();
		expect(suspend?.reason).toBe("timeout");
		expect(suspend?.nativeId).toBe(sessionRef.nativeId);
		expect(suspend?.nativeId.length).toBeGreaterThan(0);
		expect(typeof suspend?.elapsedMs).toBe("number");
		// suspend is terminal: no error and no done follow it
		expect(extractError(events)).toBeUndefined();
		expect(extractDone(events)).toBeUndefined();
	});

	it("serializes concurrent sends per nativeId via mutex", async () => {
		const log: string[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		const spawnFn: SpawnFn = async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			log.push(`enter`);
			await new Promise((r) => setTimeout(r, 30));
			inFlight -= 1;
			log.push(`exit`);
			return {
				stdout: "",
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 1,
			};
		};
		const turnsReader: TurnsReader = async () => [];
		const adapter = createHermesAdapter({ spawnFn, turnsReader });
		const r = ref();
		await Promise.all([
			drain(adapter.send(r, "first")),
			drain(adapter.send(r, "second")),
		]);
		expect(maxInFlight).toBe(1);
		expect(log).toEqual(["enter", "exit", "enter", "exit"]);
	});

	it("preserves unicode + multiline content via argv", async () => {
		let captured: string[] = [];
		const spawnFn: SpawnFn = async (a) => {
			captured = a.args;
			return {
				stdout: "",
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 0,
			};
		};
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: async () => [],
		});
		const content = 'line1\nline2\n中文 🍊 "quoted"';
		await drain(adapter.send(ref(), content));
		expect(captured).toContain(content);
	});

	it("throws synchronously on empty content", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn(),
			turnsReader: async () => [],
		});
		expect(() => adapter.send(ref(), "")).toThrow(/non-empty/);
	});

	it("computes delta against the JSONL file (v0.15.1 behavior)", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "sumeru-send-jsonl-"));
		const jsonlPath = join(sessionsDir, `${NATIVE}.jsonl`);
		writeFileSync(
			jsonlPath,
			[
				JSON.stringify({
					role: "session_meta",
					model: "x",
					timestamp: "2026-06-13T00:00:00.000000",
				}),
				JSON.stringify({
					role: "user",
					content: "old user",
					timestamp: "2026-06-13T00:00:01.000000",
				}),
				JSON.stringify({
					role: "assistant",
					content: "old asst",
					timestamp: "2026-06-13T00:00:02.000000",
				}),
				"",
			].join("\n"),
			"utf-8",
		);
		const spawnFn: SpawnFn = async () => {
			writeFileSync(
				jsonlPath,
				[
					JSON.stringify({
						role: "session_meta",
						model: "x",
						timestamp: "2026-06-13T00:00:00.000000",
					}),
					JSON.stringify({
						role: "user",
						content: "old user",
						timestamp: "2026-06-13T00:00:01.000000",
					}),
					JSON.stringify({
						role: "assistant",
						content: "old asst",
						timestamp: "2026-06-13T00:00:02.000000",
					}),
					JSON.stringify({
						role: "user",
						content: "new q",
						timestamp: "2026-06-13T00:00:03.000000",
					}),
					JSON.stringify({
						role: "assistant",
						content: "new a",
						timestamp: "2026-06-13T00:00:04.000000",
					}),
					"",
				].join("\n"),
				"utf-8",
			);
			return {
				stdout: "",
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 0,
			};
		};
		const adapter = createHermesAdapter({ spawnFn, sessionsDir });
		const events = await collectEvents(adapter.send(ref(), "new q"));
		const turns = extractTurns(events);
		expect(turns.length).toBe(2);
		expect(turns[0].role).toBe("user");
		expect(turns[0].content).toBe("new q");
		expect(turns[1].role).toBe("assistant");
		expect(turns[1].content).toBe("new a");
		expect(turns[0].index).toBe(2);
		expect(turns[1].index).toBe(3);
	});

	// Opt-in integration: verify resume context against a real Hermes binary.
	it.skipIf(process.env.SUMERU_HERMES_INTEGRATION !== "1")(
		"resume context: r2 sees the number from r1",
		async () => {
			const adapter = createHermesAdapter({});
			const sessionRef = await adapter.createSession({
				model: "anthropic/claude-haiku-4",
				cwd: null,
			});
			try {
				await drain(
					adapter.send(
						sessionRef,
						"My favorite number is 42. Acknowledge briefly.",
					),
				);
				const events = await collectEvents(
					adapter.send(
						sessionRef,
						"What is my favorite number? Reply with just the digits.",
					),
				);
				const turns = extractTurns(events);
				const assistantContent = turns
					.filter((t) => t.role === "assistant")
					.map((t) => t.content)
					.join(" ");
				expect(assistantContent).toContain("42");
			} finally {
				await adapter.close(sessionRef);
			}
		},
		90_000,
	);
});
