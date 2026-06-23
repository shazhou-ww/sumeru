/**
 * Unit tests for the docker-launch module (issue #85, phase 2).
 *
 * Covers the three named exports the deploy-mode launch path is built on:
 *   - `buildComposeEnv`   — pure name/deploy.* → compose env mapping
 *   - `isDockerAvailable` — injectable `docker info` probe (ENOENT / status)
 *   - `launchDockerCompose` — materialize-if-absent → spawn the thin wrapper
 *
 * No real Docker and no built CLI are needed here — the spawn seam is injected
 * and template materialization runs against real temp dirs.
 *
 * See specs/cli/start-deploy-mode-dispatch.md and
 * specs/cli/start-docker-unavailable.md.
 */

import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeployConfig } from "../src/deploy-config.js";
import {
	buildComposeEnv,
	DOCKER_UNAVAILABLE_MESSAGE,
	isDockerAvailable,
	type LaunchChild,
	launchDockerCompose,
	type SpawnComposeFn,
	type SpawnSyncFn,
} from "../src/docker-launch.js";

const TEMPLATE_NAMES = [
	"Dockerfile",
	"docker-compose.yaml",
	"sumeru.env.example",
];

const dockerDeploy: DeployConfig = {
	mode: "docker",
	port: 7901,
	workspace: "~/units/alpha",
	image: "sumeru:latest",
};

const localDeploy: DeployConfig = {
	mode: "local",
	port: null,
	workspace: null,
	image: null,
};

function tmpUnitDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-unit-"));
}

const dirs: string[] = [];
function makeUnit(withConfig = true): { dir: string; configPath: string } {
	const dir = tmpUnitDir();
	dirs.push(dir);
	const configPath = join(dir, "sumeru.yaml");
	if (withConfig) writeFileSync(configPath, "name: alpha\n", "utf-8");
	return { dir, configPath };
}

afterEach(() => {
	while (dirs.length > 0) {
		const d = dirs.pop();
		if (d !== undefined) rmSync(d, { recursive: true, force: true });
	}
});

describe("buildComposeEnv — name/deploy.* → compose env (issue #85)", () => {
	it("maps a full docker deploy block onto the four unit-specific vars", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/somewhere/unit/sumeru.yaml",
			deploy: dockerDeploy,
		});
		expect(env.SUMERU_PORT).toBe("7901");
		expect(env.WORKSPACE).toBe(join(homedir(), "units", "alpha"));
		expect(env.SUMERU_IMAGE).toBe("sumeru:latest");
		expect(env.SUMERU_CONFIG).toBe("./sumeru.yaml");
	});

	it("expands a leading ~ to the home directory (never leaks a literal ~)", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/u/sumeru.yaml",
			deploy: { ...dockerDeploy, workspace: "~" },
		});
		expect(env.WORKSPACE).toBe(homedir());
		expect(env.WORKSPACE.includes("~")).toBe(false);
	});

	it("leaves an absolute workspace path untouched", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/u/sumeru.yaml",
			deploy: { ...dockerDeploy, workspace: "/abs/workspace" },
		});
		expect(env.WORKSPACE).toBe("/abs/workspace");
	});

	it("SUMERU_CONFIG is the config basename made relative to the unit dir", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/deep/nested/unit/my-config.yaml",
			deploy: dockerDeploy,
		});
		expect(env.SUMERU_CONFIG).toBe(`./${basename("my-config.yaml")}`);
	});

	it("omits every var whose deploy.* source is null (compose default applies)", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/u/sumeru.yaml",
			deploy: localDeploy,
		});
		expect("SUMERU_PORT" in env).toBe(false);
		expect("WORKSPACE" in env).toBe(false);
		expect("SUMERU_IMAGE" in env).toBe(false);
		// SUMERU_CONFIG is always derivable from -c, so it is still set.
		expect(env.SUMERU_CONFIG).toBe("./sumeru.yaml");
	});

	it("never sets a SUMERU_PROJECT var — identity rides on `-p <name>`", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/u/sumeru.yaml",
			deploy: dockerDeploy,
		});
		expect("SUMERU_PROJECT" in env).toBe(false);
	});

	it("preserves the inherited environment (PATH survives into compose)", () => {
		const env = buildComposeEnv({
			name: "alpha",
			configPath: "/u/sumeru.yaml",
			deploy: dockerDeploy,
		});
		expect(env.PATH).toBe(process.env.PATH);
	});
});

describe("isDockerAvailable — injectable docker info probe (issue #85)", () => {
	it("returns true when the probe exits 0", () => {
		const run: SpawnSyncFn = () => ({ status: 0, error: null });
		expect(isDockerAvailable(run)).toBe(true);
	});

	it("returns false when the probe exits non-zero (daemon down)", () => {
		const run: SpawnSyncFn = () => ({ status: 1, error: null });
		expect(isDockerAvailable(run)).toBe(false);
	});

	it("returns false when the binary is missing (ENOENT)", () => {
		const enoent = Object.assign(new Error("spawn docker ENOENT"), {
			code: "ENOENT",
		});
		const run: SpawnSyncFn = () => ({ status: null, error: enoent });
		expect(isDockerAvailable(run)).toBe(false);
	});

	it("probes `info` against the resolved docker bin", () => {
		const calls: Array<{ command: string; args: string[] }> = [];
		const run: SpawnSyncFn = (command, args) => {
			calls.push({ command, args });
			return { status: 0, error: null };
		};
		isDockerAvailable(run);
		expect(calls).toEqual([{ command: "docker", args: ["info"] }]);
	});
});

describe("launchDockerCompose — thin compose wrapper (issue #85)", () => {
	function fakeSpawn(): {
		spawnCompose: SpawnComposeFn;
		captured: {
			bin: string;
			args: string[];
			cwd: string;
			stdio: string;
			env: Record<string, string>;
		} | null;
		fireExit: (code: number | null) => void;
	} {
		let exitCb: ((code: number | null) => void) | null = null;
		const state: {
			captured: {
				bin: string;
				args: string[];
				cwd: string;
				stdio: string;
				env: Record<string, string>;
			} | null;
		} = { captured: null };
		const spawnCompose: SpawnComposeFn = (bin, args, options) => {
			state.captured = {
				bin,
				args: [...args],
				cwd: options.cwd,
				stdio: options.stdio,
				env: options.env,
			};
			const child: LaunchChild = {
				onExit: (cb) => {
					exitCb = cb;
				},
				onError: () => {},
			};
			return child;
		};
		return {
			spawnCompose,
			get captured() {
				return state.captured;
			},
			fireExit: (code) => {
				if (exitCb !== null) exitCb(code);
			},
		};
	}

	it("spawns `docker compose -p <name> up -d --build` with cwd=unit dir, stdio inherit", async () => {
		const { dir, configPath } = makeUnit();
		const fake = fakeSpawn();
		const promise = launchDockerCompose(
			{ name: "alpha", configPath, deploy: dockerDeploy },
			{ spawnCompose: fake.spawnCompose },
		);
		fake.fireExit(0);
		const code = await promise;
		expect(code).toBe(0);
		expect(fake.captured).not.toBeNull();
		expect(fake.captured?.bin).toBe("docker");
		expect(fake.captured?.args).toEqual([
			"compose",
			"-p",
			"alpha",
			"up",
			"-d",
			"--build",
		]);
		expect(fake.captured?.cwd).toBe(dir);
		expect(fake.captured?.stdio).toBe("inherit");
		expect(fake.captured?.env.SUMERU_PORT).toBe("7901");
		expect(fake.captured?.env.SUMERU_CONFIG).toBe("./sumeru.yaml");
	});

	it("resolves with the child's non-zero exit code (passthrough)", async () => {
		const { configPath } = makeUnit();
		const fake = fakeSpawn();
		const promise = launchDockerCompose(
			{ name: "alpha", configPath, deploy: dockerDeploy },
			{ spawnCompose: fake.spawnCompose },
		);
		fake.fireExit(7);
		expect(await promise).toBe(7);
	});

	it("materializes the three templates into an empty unit dir before spawning", async () => {
		const { dir, configPath } = makeUnit();
		const fake = fakeSpawn();
		const promise = launchDockerCompose(
			{ name: "alpha", configPath, deploy: dockerDeploy },
			{ spawnCompose: fake.spawnCompose },
		);
		fake.fireExit(0);
		await promise;
		for (const name of TEMPLATE_NAMES) {
			expect(existsSync(join(dir, name))).toBe(true);
		}
	});

	it("reuse-don't-clobber: a hand-edited compose file survives; the rest are filled in", async () => {
		const { dir, configPath } = makeUnit();
		const composePath = join(dir, "docker-compose.yaml");
		writeFileSync(composePath, "# HAND EDITED — keep me\n", "utf-8");
		const fake = fakeSpawn();
		const promise = launchDockerCompose(
			{ name: "alpha", configPath, deploy: dockerDeploy },
			{ spawnCompose: fake.spawnCompose },
		);
		fake.fireExit(0);
		await promise;
		expect(readFileSync(composePath, "utf-8")).toBe(
			"# HAND EDITED — keep me\n",
		);
		expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
		expect(existsSync(join(dir, "sumeru.env.example"))).toBe(true);
	});

	it("when all three templates already exist, writes nothing (all preserved)", async () => {
		const { dir, configPath } = makeUnit();
		const sentinels: Record<string, string> = {
			Dockerfile: "# sentinel dockerfile\n",
			"docker-compose.yaml": "# sentinel compose\n",
			"sumeru.env.example": "# sentinel env\n",
		};
		for (const [name, body] of Object.entries(sentinels)) {
			writeFileSync(join(dir, name), body, "utf-8");
		}
		const fake = fakeSpawn();
		const promise = launchDockerCompose(
			{ name: "alpha", configPath, deploy: dockerDeploy },
			{ spawnCompose: fake.spawnCompose },
		);
		fake.fireExit(0);
		await promise;
		for (const [name, body] of Object.entries(sentinels)) {
			expect(readFileSync(join(dir, name), "utf-8")).toBe(body);
		}
	});
});

describe("DOCKER_UNAVAILABLE_MESSAGE — exact downgrade wording (issue #85)", () => {
	it("is the single verbatim line the spec pins", () => {
		expect(DOCKER_UNAVAILABLE_MESSAGE).toBe(
			"Docker is not available. Install Docker or set deploy.mode: local in your config.",
		);
		expect(DOCKER_UNAVAILABLE_MESSAGE.includes("\n")).toBe(false);
	});
});
