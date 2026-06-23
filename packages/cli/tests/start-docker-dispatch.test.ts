/**
 * End-to-end test for the deploy.mode dispatch (issue #85, phase 2).
 *
 * Spawns the BUILT CLI (`dist/cli.js`) with `SUMERU_DOCKER_BIN` pointed at a
 * fake `docker` that records its argv / cwd / env to a file and exits with a
 * chosen code. Asserts the thin-wrapper contract from
 * specs/cli/start-deploy-mode-dispatch.md:
 *   - argv is exactly `compose -p <name> up -d --build`,
 *   - child cwd is the unit dir, env carries the mapped SUMERU_* vars,
 *   - templates are materialized, no pid file / no `Listening on` line,
 *   - the host exits with the compose child's code, stderr is passed through,
 *   - a local / absent deploy block never probes Docker (zero regression).
 */

import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const dirs: string[] = [];
function tmpDir(prefix: string): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(d);
	return d;
}

afterEach(() => {
	while (dirs.length > 0) {
		const d = dirs.pop();
		if (d !== undefined) rmSync(d, { recursive: true, force: true });
	}
});

const FAKE_DOCKER = [
	"#!/usr/bin/env node",
	'"use strict";',
	'const fs = require("node:fs");',
	"const argv = process.argv.slice(2);",
	"const record = process.env.FAKE_DOCKER_RECORD;",
	"function append(obj) {",
	'  if (record) fs.appendFileSync(record, JSON.stringify(obj) + "\\n");',
	"}",
	'if (argv[0] === "info") {',
	'  append({ kind: "info", argv });',
	'  process.exit(Number(process.env.FAKE_DOCKER_INFO_EXIT || "0"));',
	"}",
	"append({",
	'  kind: "compose",',
	"  argv,",
	"  cwd: process.cwd(),",
	"  env: {",
	"    SUMERU_PORT: process.env.SUMERU_PORT ?? null,",
	"    WORKSPACE: process.env.WORKSPACE ?? null,",
	"    SUMERU_IMAGE: process.env.SUMERU_IMAGE ?? null,",
	"    SUMERU_CONFIG: process.env.SUMERU_CONFIG ?? null,",
	"    SUMERU_PROJECT: process.env.SUMERU_PROJECT ?? null,",
	"  },",
	"});",
	"if (process.env.FAKE_DOCKER_STDERR) {",
	'  process.stderr.write(process.env.FAKE_DOCKER_STDERR + "\\n");',
	"}",
	'process.exit(Number(process.env.FAKE_DOCKER_EXIT || "0"));',
	"",
].join("\n");

function writeFakeDocker(): string {
	const dir = tmpDir("sumeru-fakedocker-");
	const p = join(dir, "fake-docker.cjs");
	writeFileSync(p, FAKE_DOCKER, "utf-8");
	chmodSync(p, 0o755);
	return p;
}

function dockerUnit(): { dir: string; configPath: string } {
	const dir = tmpDir("sumeru-unit-");
	const configPath = join(dir, "sumeru.yaml");
	writeFileSync(
		configPath,
		[
			"name: alpha",
			"workspaceRoot: /workspace",
			"deploy:",
			"  mode: docker",
			"  port: 7901",
			"  workspace: ~/units/alpha",
			"  image: sumeru:latest",
			"gateways:",
			"  hermes:",
			"    adapter: hermes",
			"    capabilities: { resume: true, streaming: true }",
			"",
		].join("\n"),
		"utf-8",
	);
	return { dir, configPath };
}

type RunResult = { code: number | null; stdout: string; stderr: string };

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI_PATH, ...args], {
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});
		child.on("exit", (code) => resolve({ code, stdout, stderr }));
	});
}

function readRecords(path: string): Array<Record<string, unknown>> {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("sumeru start — docker dispatch thin wrapper (issue #85)", () => {
	it("runs `docker compose -p alpha up -d --build` in the unit dir with mapped env", async () => {
		const fake = writeFakeDocker();
		const { dir, configPath } = dockerUnit();
		const record = join(tmpDir("sumeru-rec-"), "calls.jsonl");
		const pidPath = join(tmpDir("sumeru-pid-"), "sumeru.pid");

		const res = await runCli(["start", "-c", configPath], {
			SUMERU_DOCKER_BIN: fake,
			FAKE_DOCKER_RECORD: record,
			SUMERU_PID_FILE: pidPath,
		});

		expect(res.code).toBe(0);
		// No local server path was taken.
		expect(res.stdout).not.toMatch(/Listening on/);
		expect(existsSync(pidPath)).toBe(false);

		const compose = readRecords(record).filter((r) => r.kind === "compose");
		expect(compose.length).toBe(1);
		const call = compose[0] as {
			argv: string[];
			cwd: string;
			env: Record<string, string | null>;
		};
		expect(call.argv).toEqual([
			"compose",
			"-p",
			"alpha",
			"up",
			"-d",
			"--build",
		]);
		expect(realpathSync(call.cwd)).toBe(realpathSync(dir));
		expect(call.env.SUMERU_PORT).toBe("7901");
		expect(call.env.SUMERU_IMAGE).toBe("sumeru:latest");
		expect(call.env.SUMERU_CONFIG).toBe("./sumeru.yaml");
		expect(call.env.WORKSPACE).toBe(join(homedir(), "units", "alpha"));
		// Identity rides on -p, never an env var.
		expect(call.env.SUMERU_PROJECT).toBeNull();

		// Templates were materialized into the unit dir before spawn.
		for (const name of [
			"Dockerfile",
			"docker-compose.yaml",
			"sumeru.env.example",
		]) {
			expect(existsSync(join(dir, name))).toBe(true);
		}
	}, 20_000);

	it("exits with the compose child's non-zero code and passes stderr through", async () => {
		const fake = writeFakeDocker();
		const { configPath } = dockerUnit();
		const record = join(tmpDir("sumeru-rec-"), "calls.jsonl");

		const res = await runCli(["start", "-c", configPath], {
			SUMERU_DOCKER_BIN: fake,
			FAKE_DOCKER_RECORD: record,
			FAKE_DOCKER_EXIT: "7",
			FAKE_DOCKER_STDERR: "compose: port already allocated",
			SUMERU_PID_FILE: join(tmpDir("sumeru-pid-"), "sumeru.pid"),
		});

		expect(res.code).toBe(7);
		expect(res.stderr).toContain("compose: port already allocated");
		// No launcher stack trace leaks for an ordinary compose failure.
		expect(res.stderr).not.toMatch(/Failed to start docker compose/);
		expect(res.stderr).not.toMatch(/\n\s+at /);
	}, 20_000);

	it("reuse-don't-clobber: a hand-edited compose file survives the auto-start materialize", async () => {
		const fake = writeFakeDocker();
		const { dir, configPath } = dockerUnit();
		const composePath = join(dir, "docker-compose.yaml");
		writeFileSync(composePath, "# HAND EDITED — keep me\n", "utf-8");

		const res = await runCli(["start", "-c", configPath], {
			SUMERU_DOCKER_BIN: fake,
			FAKE_DOCKER_RECORD: join(tmpDir("sumeru-rec-"), "calls.jsonl"),
			SUMERU_PID_FILE: join(tmpDir("sumeru-pid-"), "sumeru.pid"),
		});

		expect(res.code).toBe(0);
		expect(readFileSync(composePath, "utf-8")).toBe(
			"# HAND EDITED — keep me\n",
		);
		// The other two were filled in.
		expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
		expect(existsSync(join(dir, "sumeru.env.example"))).toBe(true);
	}, 20_000);

	it("local deploy mode never probes Docker and takes the local path (zero regression)", async () => {
		const fake = writeFakeDocker();
		const dir = tmpDir("sumeru-unit-");
		const configPath = join(dir, "sumeru.yaml");
		writeFileSync(
			configPath,
			[
				"name: alpha",
				"deploy:",
				"  mode: local",
				"gateways:",
				"  hermes:",
				"    adapter: hermes",
				"    capabilities: { resume: true, streaming: true }",
				"",
			].join("\n"),
			"utf-8",
		);
		const record = join(tmpDir("sumeru-rec-"), "calls.jsonl");
		const ocas = tmpDir("sumeru-ocas-");
		const pidPath = join(tmpDir("sumeru-pid-"), "sumeru.pid");

		// Local path starts a real server — boot it, assert, then SIGTERM.
		const child = spawn(
			process.execPath,
			[CLI_PATH, "start", "-c", configPath, "--port", "0", "--ocas-dir", ocas],
			{
				env: {
					...process.env,
					SUMERU_DOCKER_BIN: fake,
					FAKE_DOCKER_RECORD: record,
					SUMERU_PID_FILE: pidPath,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});

		await new Promise<void>((resolve, reject) => {
			const t = setTimeout(
				() => reject(new Error(`no listening line; stdout=${stdout}`)),
				8_000,
			);
			child.stdout?.on("data", () => {
				if (/Listening on http:\/\//.test(stdout)) {
					clearTimeout(t);
					resolve();
				}
			});
			child.on("exit", () => {
				clearTimeout(t);
				reject(new Error(`exited early; stdout=${stdout}`));
			});
		});

		// Docker was never invoked — not even the `info` probe.
		expect(readRecords(record).length).toBe(0);

		child.kill("SIGTERM");
		await new Promise<void>((resolve) => child.on("exit", () => resolve()));
	}, 20_000);
});
