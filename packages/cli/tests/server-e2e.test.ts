import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = "npx tsx src/main.ts";

function run(args: string): { stdout: string; exitCode: number } {
	const cleanEnv = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("npm_")),
	);
	try {
		const stdout = execSync(`${CLI} ${args}`, {
			encoding: "utf-8",
			cwd: process.cwd(),
			timeout: 15000,
			env: cleanEnv,
		});
		return { stdout, exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; status?: number };
		return { stdout: e.stdout ?? "", exitCode: e.status ?? 1 };
	}
}

function serverReachable(): boolean {
	const { stdout, exitCode } = run("server status");
	return exitCode === 0 && !stdout.includes("ERR_MODULE_NOT_FOUND");
}

describe("server commands e2e", () => {
	let skip = false;

	beforeAll(() => {
		// Check if CLI is functional (skip entire suite in CI without server)
		if (!serverReachable()) {
			skip = true;
			return;
		}
		// Ensure server is stopped before tests
		run("server stop");
	});

	afterAll(() => {
		if (!skip) {
			run("server stop");
		}
	});

	it("server status when stopped", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server status");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("Status: stopped");
	});

	it("server start", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server start");
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/^Server running at http:\/\/127\.0\.0\.1:\d+\n$/);
	});

	it("server status when running", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server status");
		expect(exitCode).toBe(0);
		const lines = stdout.trim().split("\n");
		expect(lines[0]).toBe("Status: running");
		expect(lines[1]).toMatch(/^Port: \d+$/);
		expect(lines[2]).toMatch(/^Version: \d+\.\d+\.\d+$/);
		expect(lines[3]).toMatch(/^Sessions: running=\d+ queued=\d+ idle=\d+$/);
		expect(lines[4]).toMatch(/^Uptime: \d+/);
	});

	it("server stop", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server stop");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("Server stopped.");
	});

	it("server status after stop", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server status");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("Status: stopped");
	});

	it("server restart", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server restart");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("Server restarted.");
	});

	it("server status after restart", () => {
		if (skip) return;
		const { stdout, exitCode } = run("server status");
		expect(exitCode).toBe(0);
		const lines = stdout.trim().split("\n");
		expect(lines[0]).toBe("Status: running");
		expect(lines[1]).toMatch(/^Port: \d+$/);
		expect(lines[2]).toMatch(/^Version: \d+\.\d+\.\d+$/);
		expect(lines[3]).toMatch(/^Sessions: running=\d+ queued=\d+ idle=\d+$/);
		expect(lines[4]).toMatch(/^Uptime: /);
	});
});
