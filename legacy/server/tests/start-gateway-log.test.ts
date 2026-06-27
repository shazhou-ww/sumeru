import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

function stubAdapter(name: string): Adapter {
	return {
		name,
		createSession: vi.fn() as Adapter["createSession"],
		send: vi.fn() as unknown as Adapter["send"],
		close: vi.fn() as Adapter["close"],
		getTurns: vi.fn() as Adapter["getTurns"],
	};
}

describe("startServer — per-gateway startup logging", () => {
	let server: StartedServer;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		if (server) await server.stop();
		logSpy.mockRestore();
	});

	it("logs ready for a gateway whose adapter is registered", async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {
				hermes: {
					adapter: "hermes",
					capabilities: { resume: true, streaming: true },
					config: null,
				},
			},
			workspaceRoot: null,
			adapters: { hermes: stubAdapter("hermes") },
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});

		const calls = logSpy.mock.calls.map((c) => c[0]);
		expect(calls).toContain(
			"[sumeru] gateway hermes -> adapter @sumeru/adapter-hermes (ready)",
		);
	});

	it("logs unavailable for a gateway whose adapter is not registered", async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {
				"claude-code": {
					adapter: "claude-code",
					capabilities: { resume: true, streaming: false },
					config: null,
				},
			},
			workspaceRoot: null,
			adapters: {},
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});

		const calls = logSpy.mock.calls.map((c) => c[0]);
		expect(calls).toContain(
			"[sumeru] gateway claude-code -> adapter @sumeru/adapter-claude-code (unavailable: not registered)",
		);
	});

	it("prints gateway lines after the ocas store line in config order", async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {
				hermes: {
					adapter: "hermes",
					capabilities: { resume: true, streaming: true },
					config: null,
				},
				"claude-code": {
					adapter: "claude-code",
					capabilities: { resume: true, streaming: false },
					config: null,
				},
			},
			workspaceRoot: null,
			adapters: { hermes: stubAdapter("hermes") },
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});

		const calls = logSpy.mock.calls.map((c) => c[0]) as string[];
		const ocasIdx = calls.findIndex((l) =>
			l.startsWith("[sumeru] ocas store:"),
		);
		const hermesIdx = calls.indexOf(
			"[sumeru] gateway hermes -> adapter @sumeru/adapter-hermes (ready)",
		);
		const claudeIdx = calls.indexOf(
			"[sumeru] gateway claude-code -> adapter @sumeru/adapter-claude-code (unavailable: not registered)",
		);

		// All lines present
		expect(ocasIdx).toBeGreaterThanOrEqual(0);
		expect(hermesIdx).toBeGreaterThanOrEqual(0);
		expect(claudeIdx).toBeGreaterThanOrEqual(0);

		// Gateway lines come after ocas line
		expect(hermesIdx).toBeGreaterThan(ocasIdx);
		expect(claudeIdx).toBeGreaterThan(ocasIdx);

		// Config declaration order preserved
		expect(hermesIdx).toBeLessThan(claudeIdx);
	});

	it("each gateway line matches the expected format regex", async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {
				hermes: {
					adapter: "hermes",
					capabilities: { resume: true, streaming: true },
					config: null,
				},
				"claude-code": {
					adapter: "claude-code",
					capabilities: { resume: true, streaming: false },
					config: null,
				},
			},
			workspaceRoot: null,
			adapters: { hermes: stubAdapter("hermes") },
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});

		const pattern =
			/^\[sumeru\] gateway [\w-]+ -> adapter @sumeru\/adapter-[\w-]+ \((ready|unavailable: not registered)\)$/;
		const calls = logSpy.mock.calls.map((c) => c[0]) as string[];
		const gatewayLines = calls.filter((l) => l.startsWith("[sumeru] gateway "));

		expect(gatewayLines).toHaveLength(2);
		for (const line of gatewayLines) {
			expect(line).toMatch(pattern);
		}
	});

	it("prints exactly one line per gateway, no extras", async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {
				hermes: {
					adapter: "hermes",
					capabilities: { resume: true, streaming: true },
					config: null,
				},
			},
			workspaceRoot: null,
			adapters: { hermes: stubAdapter("hermes") },
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});

		const calls = logSpy.mock.calls.map((c) => c[0]) as string[];
		const gatewayLines = calls.filter((l) => l.startsWith("[sumeru] gateway "));
		expect(gatewayLines).toHaveLength(1);
	});
});
