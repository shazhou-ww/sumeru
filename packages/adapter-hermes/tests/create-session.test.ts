import { describe, expect, it } from "vitest";
import type { SpawnFn, TurnsReader } from "../src/index.js";
import { createHermesAdapter } from "../src/index.js";

const VALID_SESSION = "20260613_120000_abcd12";

function makeSpawn(
	stdout: string,
	opts: Partial<{
		exitCode: number;
		stderr: string;
		durationMs: number;
		timedOut: boolean;
	}> = {},
): SpawnFn {
	return async () => ({
		stdout,
		stderr: opts.stderr ?? "",
		exitCode: opts.exitCode ?? 0,
		signal: null,
		timedOut: opts.timedOut ?? false,
		durationMs: opts.durationMs ?? 1,
	});
}

const emptyTurns: TurnsReader = async () => [];

describe("@sumeru/adapter-hermes — createSession", () => {
	it("parses 'Session: <id>' line and returns NativeSessionRef", async () => {
		const spawnFn = makeSpawn(`hello world\nSession: ${VALID_SESSION}\nbye\n`);
		const adapter = createHermesAdapter({ spawnFn, turnsReader: emptyTurns });
		const ref = await adapter.createSession({
			model: "anthropic/claude-haiku-4",
		});
		expect(ref.nativeId).toBe(VALID_SESSION);
		expect(ref.meta.sourceTag).toBe("sumeru");
		expect(ref.meta.model).toBe("anthropic/claude-haiku-4");
		expect(typeof ref.meta.cwd).toBe("string");
		expect(typeof ref.meta.createdAt).toBe("string");
		expect(/Z$/.test(String(ref.meta.createdAt))).toBe(true);
	});

	it("model is null when config omits it", async () => {
		const spawnFn = makeSpawn(`Session: ${VALID_SESSION}\n`);
		const adapter = createHermesAdapter({ spawnFn, turnsReader: emptyTurns });
		const ref = await adapter.createSession({});
		expect(ref.meta.model).toBeNull();
	});

	it("uses configured sourceTag and passes it via --source", async () => {
		const captured: { args: string[] } = { args: [] };
		const spawnFn: SpawnFn = async (a) => {
			captured.args = a.args;
			return {
				stdout: `Session: ${VALID_SESSION}\n`,
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 0,
			};
		};
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: emptyTurns,
			sourceTag: "sumeru-test",
		});
		await adapter.createSession({});
		expect(captured.args).toContain("--source");
		const idx = captured.args.indexOf("--source");
		expect(captured.args[idx + 1]).toBe("sumeru-test");
	});

	it("rejects when stdout has no Session line", async () => {
		const spawnFn = makeSpawn("nothing useful here\n");
		const adapter = createHermesAdapter({ spawnFn, turnsReader: emptyTurns });
		await expect(adapter.createSession({})).rejects.toThrow(
			/failed to parse Hermes session id/,
		);
	});

	it("rejects on non-zero exit", async () => {
		const spawnFn = makeSpawn("", { exitCode: 7, stderr: "boom" });
		const adapter = createHermesAdapter({ spawnFn, turnsReader: emptyTurns });
		await expect(adapter.createSession({})).rejects.toThrow(
			/hermes exited with code 7/,
		);
	});

	it("rejects on timeout", async () => {
		const spawnFn = makeSpawn("", { timedOut: true });
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: emptyTurns,
			createSessionTimeoutMs: 25,
		});
		await expect(adapter.createSession({})).rejects.toThrow(
			/createSession timed out after 25ms/,
		);
	});

	it("rejects when spawn itself throws (bad bin)", async () => {
		const spawnFn: SpawnFn = async () => {
			throw new Error("ENOENT: no such file");
		};
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: emptyTurns,
			hermesBin: "/nonexistent/hermes-bin",
		});
		await expect(adapter.createSession({})).rejects.toThrow(/hermes/);
	});

	it("does not leak token-shaped fields into meta", async () => {
		const spawnFn = makeSpawn(`Session: ${VALID_SESSION}\n`);
		const adapter = createHermesAdapter({ spawnFn, turnsReader: emptyTurns });
		const ref = await adapter.createSession({
			model: "anthropic/claude-haiku-4",
			authToken: "should-not-leak",
		});
		expect(Object.keys(ref.meta).sort()).toEqual([
			"createdAt",
			"cwd",
			"model",
			"sourceTag",
		]);
	});

	it("two parallel calls produce distinct refs", async () => {
		let counter = 0;
		const spawnFn: SpawnFn = async () => {
			const id = `2026061${counter}_120000_aaaa${counter}1`;
			counter += 1;
			return {
				stdout: `Session: ${id}\n`,
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				durationMs: 0,
			};
		};
		const adapter = createHermesAdapter({ spawnFn, turnsReader: emptyTurns });
		const [a, b] = await Promise.all([
			adapter.createSession({}),
			adapter.createSession({}),
		]);
		expect(a.nativeId).not.toBe(b.nativeId);
	});

	// Opt-in integration: spawn the real `hermes` binary and verify createSession.
	// Skipped by default — set SUMERU_HERMES_INTEGRATION=1 to run.
	it.skipIf(process.env.SUMERU_HERMES_INTEGRATION !== "1")(
		"creates a real Hermes session against a live binary",
		async () => {
			const adapter = createHermesAdapter({});
			const ref = await adapter.createSession({
				model: "anthropic/claude-haiku-4",
			});
			expect(ref.nativeId).toMatch(/^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/);
			expect(ref.meta.sourceTag).toBe("sumeru");
			await adapter.close(ref);
		},
		60_000,
	);
});
