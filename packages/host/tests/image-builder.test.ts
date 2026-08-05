import { type ExecException, exec } from "node:child_process";
import { existsSync } from "node:fs";
import type { Adapter } from "@sumeru/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAdapterManifest } from "../src/adapter-manifest.js";
import { buildAdapterImage, imageExists } from "../src/image-builder.js";
import { ensureDockerd } from "../src/transport.js";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
	exec: vi.fn(),
	execSync: vi.fn(),
}));

// Mock node:fs for existsSync
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
}));

// Mock adapter-manifest
vi.mock("../src/adapter-manifest.js", () => ({
	readAdapterManifest: vi.fn(),
}));

// Mock transport (ensureDockerd)
vi.mock("../src/transport.js", () => ({
	ensureDockerd: vi.fn(),
}));

const mockExec = vi.mocked(exec);
const mockExistsSync = vi.mocked(existsSync);
const mockReadAdapterManifest = vi.mocked(readAdapterManifest);
const mockEnsureDockerd = vi.mocked(ensureDockerd);

function makeAdapter(overrides: Partial<Adapter> = {}): Adapter {
	return {
		id: "demo:abc123",
		name: "demo",
		hash: "abc123",
		version: "1.0.0",
		source: "/tmp/demo",
		imageTag: "sumeru/demo:abc123",
		cliPath: "./dist/main.js",
		defaultInstructions: "",
		defaultModel: null,
		installedAt: "2025-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("image-builder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("imageExists", () => {
		it("returns true when docker image inspect succeeds (exit code 0)", async () => {
			mockExec.mockImplementation((_cmd, callback) => {
				callback(null, { stdout: "[]", stderr: "" } as {
					stdout: string;
					stderr: string;
				});
				return undefined as unknown as import("node:child_process").ChildProcess;
			});

			const result = await imageExists("sumeru/demo:abc123");
			expect(result).toBe(true);
			expect(mockExec).toHaveBeenCalledWith(
				"docker image inspect sumeru/demo:abc123 2>/dev/null",
				expect.any(Function),
			);
		});

		it("returns false when docker image inspect fails (exit code 1)", async () => {
			mockExec.mockImplementation((_cmd, callback) => {
				callback(
					new Error("No such image") as ExecException,
					{
						stdout: "",
						stderr: "No such image",
					} as { stdout: string; stderr: string },
				);
				return undefined as unknown as import("node:child_process").ChildProcess;
			});

			const result = await imageExists("sumeru/demo:abc123");
			expect(result).toBe(false);
		});
	});

	describe("buildAdapterImage", () => {
		it("builds the image when it does not exist", async () => {
			mockEnsureDockerd.mockResolvedValue(undefined);
			mockReadAdapterManifest.mockResolvedValue({
				name: "demo",
				version: "1.0.0",
				cliPath: "./dist/main.js",
				dockerfilePath: "Dockerfile",
				defaultInstructions: "",
				defaultModel: null,
				baseImage: null,
			});
			mockExistsSync.mockReturnValue(true);

			// First call: imageExists → false (not found)
			// Second call: docker build → success
			let callCount = 0;
			mockExec.mockImplementation((_cmd, callback) => {
				callCount++;
				if (callCount === 1) {
					// imageExists check — image not found
					callback(
						new Error("No such image") as ExecException,
						{
							stdout: "",
							stderr: "No such image",
						} as { stdout: string; stderr: string },
					);
				} else {
					// docker build — success
					callback(null, {
						stdout: "Successfully built abc",
						stderr: "",
					} as { stdout: string; stderr: string });
				}
				return undefined as unknown as import("node:child_process").ChildProcess;
			});

			const adapter = makeAdapter();
			const result = await buildAdapterImage(adapter, "/tmp/demo");

			expect(result).toBe("sumeru/demo:abc123");
			expect(mockEnsureDockerd).toHaveBeenCalled();
			expect(mockExistsSync).toHaveBeenCalledWith("/tmp/demo/Dockerfile");
			expect(mockExec).toHaveBeenCalledWith(
				"docker build -t sumeru/demo:abc123 -f /tmp/demo/Dockerfile /",
				expect.any(Function),
			);
		});

		it("skips build when image already exists", async () => {
			mockEnsureDockerd.mockResolvedValue(undefined);
			mockReadAdapterManifest.mockResolvedValue({
				name: "demo",
				version: "1.0.0",
				cliPath: "./dist/main.js",
				dockerfilePath: "Dockerfile",
				defaultInstructions: "",
				defaultModel: null,
				baseImage: null,
			});
			mockExistsSync.mockReturnValue(true);

			// imageExists → true (already built)
			mockExec.mockImplementation((_cmd, callback) => {
				callback(null, { stdout: "[]", stderr: "" } as {
					stdout: string;
					stderr: string;
				});
				return undefined as unknown as import("node:child_process").ChildProcess;
			});

			const adapter = makeAdapter();
			const result = await buildAdapterImage(adapter, "/tmp/demo");

			expect(result).toBe("sumeru/demo:abc123");
			// Only one exec call: imageExists check. No build call.
			expect(mockExec).toHaveBeenCalledTimes(1);
		});

		it("throws when Dockerfile is not found", async () => {
			mockEnsureDockerd.mockResolvedValue(undefined);
			mockReadAdapterManifest.mockResolvedValue({
				name: "demo",
				version: "1.0.0",
				cliPath: "./dist/main.js",
				dockerfilePath: "Dockerfile",
				defaultInstructions: "",
				defaultModel: null,
				baseImage: null,
			});
			mockExistsSync.mockReturnValue(false);

			const adapter = makeAdapter();
			await expect(buildAdapterImage(adapter, "/tmp/demo")).rejects.toThrow(
				"Dockerfile not found: /tmp/demo/Dockerfile",
			);
		});

		it("throws when docker build fails", async () => {
			mockEnsureDockerd.mockResolvedValue(undefined);
			mockReadAdapterManifest.mockResolvedValue({
				name: "demo",
				version: "1.0.0",
				cliPath: "./dist/main.js",
				dockerfilePath: "Dockerfile",
				defaultInstructions: "",
				defaultModel: null,
				baseImage: null,
			});
			mockExistsSync.mockReturnValue(true);

			let callCount = 0;
			mockExec.mockImplementation((_cmd, callback) => {
				callCount++;
				if (callCount === 1) {
					// imageExists → not found
					callback(
						new Error("No such image") as ExecException,
						{
							stdout: "",
							stderr: "No such image",
						} as { stdout: string; stderr: string },
					);
				} else {
					// docker build → failure
					callback(
						new Error("Step 3/5: RUN npm build failed") as ExecException,
						{
							stdout: "",
							stderr: "Step 3/5: RUN npm build failed",
						} as { stdout: string; stderr: string },
					);
				}
				return undefined as unknown as import("node:child_process").ChildProcess;
			});

			const adapter = makeAdapter();
			await expect(buildAdapterImage(adapter, "/tmp/demo")).rejects.toThrow(
				"Docker build failed",
			);
		});

		it("throws when Docker daemon is not available", async () => {
			mockEnsureDockerd.mockRejectedValue(new Error("Docker is not available"));

			const adapter = makeAdapter();
			await expect(buildAdapterImage(adapter, "/tmp/demo")).rejects.toThrow(
				"Docker daemon not available",
			);
		});
	});
});
