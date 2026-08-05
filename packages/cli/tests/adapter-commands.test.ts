import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = "pnpm exec tsx src/main.ts";

function createIsolatedEnv(): {
	root: string;
	port: string;
	env: NodeJS.ProcessEnv;
} {
	const root = mkdtempSync(join(tmpdir(), "sumeru-adapter-cli-"));
	const port = String(18_000 + Math.floor(Math.random() * 1000));
	const pidFile = join(root, "sumeru.pid");
	const base = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("npm_")),
	);
	return {
		root,
		port,
		env: {
			...base,
			SUMERU_ROOT: root,
			SUMERU_HOST: "127.0.0.1",
			SUMERU_PORT: port,
			SUMERU_PID_FILE: pidFile,
		},
	};
}

function writeDemoPackage(): string {
	const pkg = mkdtempSync(join(tmpdir(), "adapter-pkg-"));
	mkdirSync(join(pkg, "src"), { recursive: true });
	writeFileSync(
		join(pkg, "sumeru-adapter.yaml"),
		["name: demo", "version: 1.0.0", "cli: ./dist/main.js"].join("\n"),
	);
	writeFileSync(join(pkg, "src", "index.ts"), "export {}");
	return pkg;
}

describe("adapter add/remove commands", () => {
	const isolated = createIsolatedEnv();
	const pkg = writeDemoPackage();

	function run(args: string): {
		stdout: string;
		stderr: string;
		exitCode: number;
	} {
		try {
			const stdout = execSync(`${CLI} ${args}`, {
				encoding: "utf-8",
				cwd: process.cwd(),
				timeout: 20000,
				stdio: ["pipe", "pipe", "pipe"],
				env: isolated.env,
			});
			return { stdout, stderr: "", exitCode: 0 };
		} catch (err: unknown) {
			const e = err as { stdout?: string; stderr?: string; status?: number };
			return {
				stdout: e.stdout ?? "",
				stderr: e.stderr ?? "",
				exitCode: e.status ?? 1,
			};
		}
	}

	beforeAll(() => {
		const { exitCode, stderr } = run("server start");
		if (exitCode !== 0) {
			throw new Error(`server start failed: ${stderr}`);
		}
	});

	afterAll(() => {
		run("server stop");
	});

	it("adapter add installs from a valid local path", () => {
		const { stdout, exitCode } = run(`adapter add ${pkg}`);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(
			/(Installed adapter|already installed) demo:[a-f0-9]{6}/,
		);
	});

	it("adapter add is idempotent", () => {
		const { stdout, exitCode } = run(`adapter add ${pkg}`);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/Adapter demo:[a-f0-9]{6} already installed/);
	});

	it("adapter remove uninstalls by name prefix", () => {
		const { stdout, exitCode } = run("adapter remove demo");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Removed adapter demo");
	});

	it("adapter remove fails for non-existent adapter", () => {
		const { stderr, exitCode } = run("adapter remove missing-adapter");
		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/not found|Adapter not found/i);
	});
});
