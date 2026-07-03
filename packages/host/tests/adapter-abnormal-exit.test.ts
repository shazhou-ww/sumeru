import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { createSessionManager } from "../src/session-manager.js";
import type { Transport, TransportExecSession } from "../src/types.js";

function writeHostFixture(rootDir: string, maxRunning = 4): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			`maxRunning: ${maxRunning}`,
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
		].join("\n"),
	);
	mkdirSync("/tmp/workspaces/demo", { recursive: true });
	const dataDir = join(rootDir, "data");
	mkdirSync(join(dataDir, "skills"), { recursive: true });
	mkdirSync(join(dataDir, "prototypes"), { recursive: true });
	writeFileSync(
		join(dataDir, "prototypes", "claude-code.yaml"),
		[
			"name: claude-code",
			"persona: default-persona",
			"model: test-provider:default-model",
			"adapter: claude-code",
		].join("\n"),
	);
	const prototypeDir = join(rootDir, "prototypes", "claude-code");
	mkdirSync(prototypeDir, { recursive: true });
	writeFileSync(
		join(prototypeDir, "compose.yaml"),
		[
			"services:",
			"  agent:",
			"    image: example",
			"    volumes:",
			`      - "${"$"}{SUMERU_PROJECT_PATH}:${"$"}{SUMERU_PROJECT_PATH}"`,
		].join("\n"),
	);
}

function createSessionBody(overrides: Record<string, unknown> = {}) {
	return {
		prototype: "claude-code",
		project: "demo",
		task: "hello",
		model: null,
		env: null,
		...overrides,
	};
}

/**
 * A transport whose adapter stdout can be destroyed mid-stream to simulate an
 * abnormally exiting adapter subprocess. The destroy surfaces as a rejected
 * async iterator inside `readAdapterOutput`, exercising its `catch` path.
 */
function createCrashableTransport(): {
	transport: Transport;
	crash(): void;
} {
	const stdouts: Array<PassThrough> = [];
	const transport: Transport = {
		async up(input) {
			return { containerId: `container-${input.projectName}` };
		},
		async down() {},
		async rm() {},
		async stop() {},
		async start() {},
		exec(_input) {
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			stdouts.push(stdout);
			stdin.on("data", (chunk: Buffer | string) => {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				if (text.includes('"init"')) {
					stdout.write(`${JSON.stringify({ type: "ready", value: {} })}\n`);
				}
				// Intentionally never emits a done frame: the session stays running
				// until the adapter stdout is destroyed via crash().
			});
			const rl = createInterface({ input: stdout, crlfDelay: Infinity });
			const session: TransportExecSession = {
				stdin,
				lines: rl,
				waitForExit: async () => ({ exitCode: 1, stderr: "boom" }),
			};
			return session;
		},
		async inspectStatus() {
			return "running";
		},
		async runOnce() {
			return { stdout: "", stderr: "", exitCode: 0 };
		},
		async commit() {
			return { imageId: "sha256:mock-image" };
		},
	};
	return {
		transport,
		crash() {
			for (const stdout of stdouts) {
				stdout.destroy(new Error("adapter stdout closed"));
			}
		},
	};
}

describe("adapter abnormal exit resilience (#177)", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		tempDirs.length = 0;
	});

	function setup(maxRunning = 4): string {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-"));
		tempDirs.push(rootDir);
		writeHostFixture(rootDir, maxRunning);
		return rootDir;
	}

	function seedDb(hostConfig: {
		sqliteStore: {
			createPersona: (input: {
				name: string;
				instructions: string;
				skills: Array<string>;
			}) => unknown;
			createProvider: (input: {
				name: string;
				apiType: string;
				baseUrl: string | null;
				apiKey: string;
			}) => unknown;
			createModel: (input: {
				name: string;
				provider: string;
				model: string;
				contextWindow: number | null;
				toolUse: boolean;
				streaming: boolean;
				metadata: null;
			}) => unknown;
		};
	}): void {
		hostConfig.sqliteStore.createProvider({
			name: "test-provider",
			apiType: "anthropic",
			baseUrl: null,
			apiKey: "sk-test",
		});
		hostConfig.sqliteStore.createModel({
			name: "default-model",
			provider: "test-provider",
			model: "claude-sonnet-4",
			contextWindow: null,
			toolUse: true,
			streaming: true,
			metadata: null,
		});
		hostConfig.sqliteStore.createPersona({
			name: "default-persona",
			instructions: "You are a worker.",
			skills: [],
		});
	}

	it("does not throw when the adapter stdout closes after the session is deleted", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, crash } = createCrashableTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await manager.createSession(createSessionBody());
		expect(created.status).toBe("running");

		// Delete first: clears the sessions + adapters records.
		await manager.deleteSession(created.id);
		expect(manager.getSession(created.id)).toBeNull();

		// Now the adapter subprocess "exits abnormally" — late catch-path frame
		// targets an already-deleted session. markIdle must early-return.
		expect(() => crash()).not.toThrow();
		await flushMicrotasks();

		// Process-equivalent invariant: manager still answers queries normally.
		expect(manager.getSession(created.id)).toBeNull();
		expect(manager.hostRoot().status.running).toBe(0);
	});

	it("releases the running slot when an adapter abnormally exits while still tracked", async () => {
		const rootDir = setup(1);
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, crash } = createCrashableTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await manager.createSession(createSessionBody());
		expect(manager.hostRoot().status.running).toBe(1);

		// Adapter dies while the session record still exists and is running.
		crash();
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const record = manager.getSession(created.id);
		expect(record?.status).toBe("idle");
		expect(record?.exit?.type).toBe("failed");
		// Slot is freed, not leaked at running forever.
		expect(manager.hostRoot().status.running).toBe(0);
	});

	it("keeps serving other sessions after one adapter crashes", async () => {
		const rootDir = setup(4);
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, crash } = createCrashableTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const a = await manager.createSession(createSessionBody({ task: "a" }));
		const b = await manager.createSession(createSessionBody({ task: "b" }));

		crash();
		await waitUntil(
			() =>
				manager.getSession(a.id)?.status === "idle" &&
				manager.getSession(b.id)?.status === "idle",
		);

		// Both transitioned to idle/failed rather than crashing the manager.
		expect(manager.getSession(a.id)?.exit?.type).toBe("failed");
		expect(manager.getSession(b.id)?.exit?.type).toBe("failed");
		// New work can still be created (host is alive, slots are free).
		const c = await manager.createSession(createSessionBody({ task: "c" }));
		expect(c.status).toBe("running");
	});
});

async function flushMicrotasks(rounds = 5): Promise<void> {
	for (let i = 0; i < rounds; i += 1) {
		await Promise.resolve();
		await new Promise((resolve) => setImmediate(resolve));
	}
}

async function waitUntil(
	predicate: () => boolean,
	timeoutMs = 2_000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("condition not met before timeout");
}
