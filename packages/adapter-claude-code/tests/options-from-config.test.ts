/**
 * Issue #32 — direct factory tests verifying `createClaudeCodeAdapter`
 * accepts the timeout / max-turn options from `sumeru.yaml`'s gateway
 * `config:` blob, and that the default `sendTimeoutMs` is now 30 minutes.
 */

import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

describe("createClaudeCodeAdapter — options forwarded from sumeru.yaml (issue #32)", () => {
	it("uses operator-supplied timeouts and maxTurns for both createSession and send", async () => {
		let phase = 0;
		const { calls, spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-config" }) };
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-config",
					userText: "hello",
					assistantText: "world",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({
			sendTimeoutMs: 1_800_000,
			createSessionTimeoutMs: 300_000,
			maxTurns: 120,
			spawnFn,
		});
		const ref = await adapter.createSession({ initialQuery: "hi" });
		await adapter.send(ref, "hello");

		expect(calls.length).toBe(2);
		// createSession spawn carries the operator's createSessionTimeoutMs.
		expect(calls[0]?.timeoutMs).toBe(300_000);
		// send spawn carries the operator's sendTimeoutMs.
		expect(calls[1]?.timeoutMs).toBe(1_800_000);
		// --max-turns is the operator's value.
		const maxTurnsIdx = calls[0]?.args.indexOf("--max-turns") ?? -1;
		expect(calls[0]?.args[maxTurnsIdx + 1]).toBe("120");
		const maxTurnsIdx2 = calls[1]?.args.indexOf("--max-turns") ?? -1;
		expect(calls[1]?.args[maxTurnsIdx2 + 1]).toBe("120");
	});

	it("default factory uses 30-min sendTimeout and 5-min createTimeout", async () => {
		let phase = 0;
		const { calls, spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-default" }) };
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-default",
					userText: "hi",
					assistantText: "ok",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.send(ref, "hi");

		expect(calls.length).toBe(2);
		expect(calls[0]?.timeoutMs).toBe(5 * 60_000);
		// 30 min — the new default introduced by issue #32 (was 10 min).
		expect(calls[1]?.timeoutMs).toBe(30 * 60_000);
	});

	it("send timeout error message reports the operator-configured value", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-timeout-msg" }) };
			}
			return { stdout: "", stderr: "", exitCode: null, timedOut: true };
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			sendTimeoutMs: 1_800_000,
		});
		const ref = await adapter.createSession({});
		await expect(adapter.send(ref, "x")).rejects.toThrow(
			/send timed out after 1800000ms/,
		);
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
		await expect(adapter.createSession({})).rejects.toThrow(
			/createSession timed out after 300000ms/,
		);
	});
});
