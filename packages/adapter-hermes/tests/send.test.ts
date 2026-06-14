import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Turn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import type { SpawnFn, TurnsReader } from "../src/index.js";
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

describe("@sumeru/adapter-hermes — send", () => {
	it("returns the delta turns produced after the call", async () => {
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
		const result = await adapter.send(ref(), "what?");
		expect(result.turns.map((t) => t.index)).toEqual([1, 2]);
		expect(result.turns[0].role).toBe("user");
		expect(result.turns[1].role).toBe("assistant");
		expect(typeof result.durationMs).toBe("number");
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
		const result = await adapter.send(ref(), "go");
		expect(result.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
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
		await adapter.send(ref(), "ping");
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

	it("rejects after close with 'is closed'", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn(),
			turnsReader: async () => [],
		});
		const r = ref();
		await adapter.close(r);
		await expect(adapter.send(r, "hi")).rejects.toThrow(/is closed/);
	});

	it("rejects on non-zero hermes exit with stderr tail", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn({ exitCode: 1, stderr: "session not found" }),
			turnsReader: async () => [],
		});
		await expect(adapter.send(ref(), "hi")).rejects.toThrow(/not found/);
	});

	it("rejects on timeout", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn({ timedOut: true }),
			turnsReader: async () => [],
			sendTimeoutMs: 50,
		});
		await expect(adapter.send(ref(), "hi")).rejects.toThrow(
			/send timed out after 50ms/,
		);
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
		await Promise.all([adapter.send(r, "first"), adapter.send(r, "second")]);
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
		await adapter.send(ref(), content);
		expect(captured).toContain(content);
	});

	it("rejects empty content", async () => {
		const adapter = createHermesAdapter({
			spawnFn: makeSpawn(),
			turnsReader: async () => [],
		});
		await expect(adapter.send(ref(), "")).rejects.toThrow(/non-empty/);
	});

	it("computes delta against the JSONL file (v0.15.1 behavior)", async () => {
		// Write a JSONL file with 2 existing rows; the spawnFn rewrites it
		// during the call so the post-spawn read sees 4 rows total.
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
		const r = await adapter.send(ref(), "new q");
		expect(r.turns.length).toBe(2);
		expect(r.turns[0].role).toBe("user");
		expect(r.turns[0].content).toBe("new q");
		expect(r.turns[1].role).toBe("assistant");
		expect(r.turns[1].content).toBe("new a");
		expect(r.turns[0].index).toBe(2);
		expect(r.turns[1].index).toBe(3);
	});

	// Opt-in integration: verify resume context against a real Hermes binary.
	// Sends "remember 42", then "what is my number?", confirming the second
	// reply contains "42". Skipped by default — set SUMERU_HERMES_INTEGRATION=1.
	it.skipIf(process.env.SUMERU_HERMES_INTEGRATION !== "1")(
		"resume context: r2 sees the number from r1",
		async () => {
			const adapter = createHermesAdapter({});
			const sessionRef = await adapter.createSession({
				model: "anthropic/claude-haiku-4",
				systemPrompt: "Reply tersely.",
			});
			try {
				await adapter.send(
					sessionRef,
					"My favorite number is 42. Acknowledge briefly.",
				);
				const r2 = await adapter.send(
					sessionRef,
					"What is my favorite number? Reply with just the digits.",
				);
				const assistantContent = r2.turns
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
