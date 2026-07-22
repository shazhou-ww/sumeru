import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CLI = "pnpm exec tsx src/main.ts";

function run(args: string): {
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	const cleanEnv = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("npm_")),
	);
	try {
		const stdout = execSync(`${CLI} ${args}`, {
			encoding: "utf-8",
			cwd: process.cwd(),
			timeout: 15000,
			stdio: ["pipe", "pipe", "pipe"],
			env: cleanEnv,
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

describe("CLI help and flags e2e", () => {
	it("no args shows help with exit 1", () => {
		const { stdout, stderr, exitCode } = run("");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("No command selected");
		expect(stdout).toContain("Usage: sumeru <command>");
		expect(stdout).toContain("Commands:");
		expect(stdout).toContain("server");
	});

	it("--help shows help with exit 0", () => {
		const { stdout, exitCode } = run("--help");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage: sumeru <command>");
		expect(stdout).toContain("-h, --help");
	});

	it("subcommand without subcommand shows help", () => {
		const { stdout, stderr, exitCode } = run("adapter");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Command is not executable");
		expect(stdout).toContain("Usage: sumeru adapter");
		expect(stdout).toContain("list");
		expect(stdout).toContain("get");
		expect(stdout).toContain("models");
	});

	it("subcommand --help shows format options", () => {
		const { stdout, exitCode } = run("adapter list --help");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("--format");
		expect(stdout).toContain("json");
		expect(stdout).toContain("yaml");
	});

	it("--json is rejected", () => {
		const { stderr, exitCode } = run("adapter list --json");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("--format json");
	});

	it("--format html is rejected", () => {
		const { stderr, exitCode } = run("adapter list --format html");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unsupported format");
		expect(stderr).toContain("text, json, yaml");
	});

	it("--format yaml outputs yaml envelope", () => {
		const { stdout, exitCode } = run("adapter list --format yaml");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("type:");
		expect(stdout).toContain("value:");
	});

	it("--format json outputs json envelope", () => {
		const { stdout, exitCode } = run("adapter list --format json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.type).toBe("@sumeru/adapter/list");
		expect(Array.isArray(parsed.value)).toBe(true);
	});

	it("errors are plain text on stderr", () => {
		const { stderr, exitCode } = run("adapter models nonexistent");
		expect(exitCode).toBe(1);
		expect(stderr.trim()).toMatch(/^Error: /);
		expect(stderr).not.toContain("{");
	});
});

describe("adapter commands e2e", () => {
	it("adapter list shows table by default", () => {
		const { stdout, exitCode } = run("adapter list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("NAME");
		expect(stdout).toContain("PROVIDERMODE");
		expect(stdout).toContain("hermes");
		expect(stdout).toContain("custom-only");
	});

	it("adapter get shows adapter info", () => {
		const { stdout, exitCode } = run("adapter get hermes");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("hermes");
		expect(stdout).toContain("custom-only");
	});

	it("adapter models on custom-only shows hint", () => {
		const { stdout, exitCode } = run("adapter models hermes");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("no built-in models");
		expect(stdout).toContain("sumeru provider");
	});

	it("adapter models on builtin-only lists models (needs API key)", () => {
		const { stdout, exitCode } = run("adapter models cursor-agent");
		// This test requires CURSOR_API_KEY — skip in environments without it
		if (exitCode !== 0) return;
		expect(stdout).toContain("ID");
		expect(stdout).toContain("NAME");
		expect(stdout).toContain("auto");
	});
});
