import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createContainerMock = vi.fn();
const getContainerMock = vi.fn();
const modemDemuxStreamMock = vi.fn();

vi.mock("dockerode", () => {
	class DockerMock {
		modem = { demuxStream: modemDemuxStreamMock };
		ping = vi.fn().mockResolvedValue("OK");
		createContainer = (...args: Array<unknown>) => createContainerMock(...args);
		getContainer = (...args: Array<unknown>) => getContainerMock(...args);
	}
	return { default: DockerMock };
});

import {
	createDockerTransport,
	createMockTransport,
	defaultAdapterCommand,
	resetDockerClient,
} from "../src/transport.js";

function mockStartedContainer(id = "container-abc") {
	return {
		id,
		start: vi.fn().mockResolvedValue(undefined),
	};
}

describe("createDockerTransport", () => {
	beforeEach(() => {
		createContainerMock.mockReset();
		getContainerMock.mockReset();
		modemDemuxStreamMock.mockReset();
		resetDockerClient();
	});

	afterEach(() => {
		vi.clearAllMocks();
		resetDockerClient();
	});

	it("passes SUMERU_PROJECT_PATH in compose up env", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-transport-compose-"));
		const composePath = join(rootDir, "compose.yaml");
		writeFileSync(
			composePath,
			[
				"services:",
				"  agent:",
				"    image: example",
				"    volumes:",
				'      - "${SUMERU_PROJECT_PATH}:${SUMERU_PROJECT_PATH}"',
			].join("\n"),
		);
		createContainerMock.mockResolvedValue(
			mockStartedContainer("container-abc"),
		);

		const transport = createDockerTransport();
		await transport.up({
			projectName: "ses_test",
			composePath,
			workDir: rootDir,
			projectPath: "/tmp/sumeru-e2e",
			env: { FOO: "bar" },
		});

		expect(createContainerMock).toHaveBeenCalledTimes(1);
		const createOpts = createContainerMock.mock.calls[0]?.[0] as {
			name?: string;
			Image?: string;
			Env?: Array<string>;
			HostConfig?: { Binds?: Array<string> };
		};
		expect(createOpts.name).toBe("ses_test");
		expect(createOpts.Image).toBe("example");
		expect(createOpts.Env).toEqual(
			expect.arrayContaining([
				"FOO=bar",
				"SUMERU_PROJECT_PATH=/tmp/sumeru-e2e",
			]),
		);
		expect(createOpts.HostConfig?.Binds).toContain(
			"/tmp/sumeru-e2e:/tmp/sumeru-e2e",
		);
	});

	it("runs docker run with /workspace mount for image-based prototypes", async () => {
		createContainerMock.mockResolvedValue(
			mockStartedContainer("container-run-abc"),
		);

		const transport = createDockerTransport();
		await transport.upFromImage({
			containerName: "ses_test",
			imageTag: "sumeru/codex:dev",
			workDir: "/tmp/work",
			projectPath: "/tmp/sumeru-e2e",
			cacheDir: "/tmp/work/cache",
			env: { FOO: "bar" },
		});

		expect(createContainerMock).toHaveBeenCalledTimes(1);
		const createOpts = createContainerMock.mock.calls[0]?.[0] as {
			name?: string;
			Image?: string;
			WorkingDir?: string;
			Env?: Array<string>;
			HostConfig?: { NetworkMode?: string; Binds?: Array<string> };
		};
		expect(createOpts.name).toBe("ses_test");
		expect(createOpts.Image).toBe("sumeru/codex:dev");
		expect(createOpts.WorkingDir).toBe("/workspace");
		expect(createOpts.HostConfig?.NetworkMode).toBe("host");
		expect(createOpts.HostConfig?.Binds).toContain(
			"/tmp/sumeru-e2e:/workspace:rw",
		);
		expect(createOpts.HostConfig?.Binds).toContain(
			"/tmp/work/cache/pnpm-store:/cache/pnpm-store",
		);
		expect(createOpts.Env).toEqual(
			expect.arrayContaining([
				"FOO=bar",
				"SUMERU_PROJECT_PATH=/tmp/sumeru-e2e",
			]),
		);
	});

	it("omits /workspace mount when projectPath is null", async () => {
		createContainerMock.mockResolvedValue(
			mockStartedContainer("container-run-abc"),
		);

		const transport = createDockerTransport();
		await transport.upFromImage({
			containerName: "ses_test",
			imageTag: "sumeru/codex:dev",
			workDir: "/tmp/work",
			projectPath: null,
			cacheDir: "/tmp/work/cache",
			env: null,
		});

		const createOpts = createContainerMock.mock.calls[0]?.[0] as {
			WorkingDir?: string;
			Env?: Array<string>;
			HostConfig?: { Binds?: Array<string> };
		};
		expect(createOpts.WorkingDir).toBeUndefined();
		expect(
			createOpts.HostConfig?.Binds?.some((bind) => bind.includes("/workspace")),
		).toBe(false);
		expect(createOpts.HostConfig?.Binds).toContain(
			"/tmp/work/cache/pnpm-store:/cache/pnpm-store",
		);
		expect(createOpts.Env).toBeUndefined();
	});
});

describe("defaultAdapterCommand", () => {
	it("returns unified sumeru-adapter entrypoint", () => {
		expect(defaultAdapterCommand("codex")).toEqual(["sumeru-adapter"]);
	});

	it("returns same entrypoint for all adapters", () => {
		expect(defaultAdapterCommand("hermes")).toEqual(["sumeru-adapter"]);
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

	it("records upFromImage calls", async () => {
		const { transport, calls } = createMockTransport();
		await transport.upFromImage({
			containerName: "ses_mock",
			imageTag: "sumeru/codex:dev",
			workDir: "/work",
			projectPath: "/tmp/project",
			cacheDir: "/work/cache",
			env: null,
		});
		expect(calls[0]).toEqual({
			type: "upFromImage",
			containerName: "ses_mock",
			imageTag: "sumeru/codex:dev",
			workDir: "/work",
			projectPath: "/tmp/project",
			cacheDir: "/work/cache",
			env: null,
		});
	});
});
