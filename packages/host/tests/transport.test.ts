import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (...args: Array<unknown>) => spawnMock(...args),
}));

import {
	createDockerTransport,
	createMockTransport,
	defaultAdapterCommand,
	legacyAdapterCommand,
	SUMERU_SESSION_MAIN,
} from "../src/transport.js";

function mockSpawnChild(stdout = "container-abc\n"): ChildProcess {
	const stdoutStream = new EventEmitter();
	const stderrStream = new EventEmitter();
	const child = new EventEmitter() as ChildProcess;
	child.stdout = stdoutStream as ChildProcess["stdout"];
	child.stderr = stderrStream as ChildProcess["stderr"];
	child.stdin = null;
	queueMicrotask(() => {
		stdoutStream.emit("data", Buffer.from(stdout));
		child.emit("close", 0);
	});
	return child;
}

describe("createDockerTransport", () => {
	beforeEach(() => {
		spawnMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("passes SUMERU_PROJECT_PATH in compose up env", async () => {
		let callIndex = 0;
		spawnMock.mockImplementation(() => {
			callIndex += 1;
			return mockSpawnChild(callIndex === 1 ? "" : "container-abc\n");
		});

		const transport = createDockerTransport();
		await transport.up({
			projectName: "ses_test",
			composePath: "/tmp/compose.yaml",
			workDir: "/tmp/work",
			projectPath: "/tmp/sumeru-e2e",
			env: { FOO: "bar" },
		});

		const upOptions = spawnMock.mock.calls[0]?.[2] as
			| { env?: Record<string, string> }
			| undefined;
		expect(upOptions?.env?.SUMERU_PROJECT_PATH).toBe("/tmp/sumeru-e2e");
		expect(upOptions?.env?.FOO).toBe("bar");
	});
});

describe("defaultAdapterCommand", () => {
	it("prefers sumeru-session with legacy fallback", () => {
		const command = defaultAdapterCommand("codex");
		expect(command[0]).toBe("sh");
		expect(command[1]).toBe("-c");
		expect(command[2]).toContain(SUMERU_SESSION_MAIN);
		expect(command[2]).toContain("/opt/sumeru/adapter-codex/dist/main.js");
	});

	it("legacyAdapterCommand keeps per-adapter entrypoint", () => {
		expect(legacyAdapterCommand("hermes")).toEqual([
			"node",
			"/opt/sumeru/adapter-hermes/dist/main.js",
		]);
	});
});

describe("createMockTransport", () => {
	it("records projectPath on up calls", async () => {
		const { transport, calls } = createMockTransport();
		await transport.up({
			projectName: "ses_mock",
			composePath: "/compose.yaml",
			workDir: "/work",
			projectPath: "/tmp/project",
			env: null,
		});
		expect(calls[0]).toEqual({
			type: "up",
			projectName: "ses_mock",
			composePath: "/compose.yaml",
			workDir: "/work",
			projectPath: "/tmp/project",
			env: null,
		});
	});
});
