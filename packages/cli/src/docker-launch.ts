/**
 * Docker-mode launch path for `sumeru start` (issue #85, phase 2).
 *
 * Three named exports, all pure / injectable so the CLI wiring stays a thin
 * dispatch and the behavior is unit-testable without real Docker:
 *
 *   - `buildComposeEnv`    — map `name` + `deploy.*` onto the compose env vars
 *                            (`SUMERU_PORT` / `WORKSPACE` / `SUMERU_IMAGE` /
 *                            `SUMERU_CONFIG`). `~` is expanded here at launch
 *                            time; a null `deploy.*` omits its var so the
 *                            template's `${VAR:-default}` applies.
 *   - `isDockerAvailable`  — probe `docker info`; runner injectable for tests.
 *   - `launchDockerCompose`— materialize templates into the unit dir when
 *                            absent (reuse-don't-clobber), then spawn
 *                            `docker compose -p <name> up -d --build` with the
 *                            unit dir as `cwd` and inherited stdio, resolving
 *                            with the child's exit code.
 *
 * Unit identity rides on the compose `-p <name>` flag — there is NO
 * `SUMERU_PROJECT` env var (the shipped template has no such token).
 *
 * See specs/cli/start-deploy-mode-dispatch.md and
 * specs/cli/start-docker-unavailable.md.
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { materializeDockerAssets } from "@sumeru/server";
import type { DeployConfig } from "./deploy-config.js";

/** The exact one-line downgrade message for a docker config with no Docker. */
export const DOCKER_UNAVAILABLE_MESSAGE =
	"Docker is not available. Install Docker or set deploy.mode: local in your config.";

/** The three packaged templates, in stable order (mirrors Phase-1). */
const TEMPLATE_NAMES = [
	"Dockerfile",
	"docker-compose.yaml",
	"sumeru.env.example",
] as const;

/**
 * Resolve the docker binary: `$SUMERU_DOCKER_BIN` when set (operator override /
 * test seam), otherwise the literal `docker`. Used for BOTH the availability
 * probe and the compose invocation so a single env var swaps both.
 */
function dockerBin(): string {
	const override = process.env.SUMERU_DOCKER_BIN;
	return typeof override === "string" && override.length > 0
		? override
		: "docker";
}

/** Arguments for the compose launch + env mapping. */
export type LaunchArgs = {
	name: string;
	configPath: string;
	deploy: DeployConfig;
};

/**
 * Map `name` + `deploy.*` onto the compose env vars, layered over the inherited
 * environment so adapter creds / `PATH` survive into compose.
 *
 * - `SUMERU_PORT`   ← `deploy.port` (stringified) when non-null.
 * - `WORKSPACE`     ← `deploy.workspace` with a leading `~` / `~/` expanded to
 *                     `os.homedir()`, when non-null. A literal `~` must never
 *                     reach Docker as a bind-mount source.
 * - `SUMERU_IMAGE`  ← `deploy.image` when non-null.
 * - `SUMERU_CONFIG` ← the `-c` path relative to the unit dir (`./<basename>`),
 *                     always set (it is always derivable from `-c`).
 *
 * A null `deploy.*` omits its var so the template's `${VAR:-default}` applies.
 * No `SUMERU_PROJECT` is ever set — identity rides on `-p <name>`.
 */
export function buildComposeEnv(args: LaunchArgs): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value;
	}

	if (args.deploy.port !== null) {
		env.SUMERU_PORT = String(args.deploy.port);
	}
	if (args.deploy.workspace !== null) {
		env.WORKSPACE = expandTilde(args.deploy.workspace);
	}
	if (args.deploy.image !== null) {
		env.SUMERU_IMAGE = args.deploy.image;
	}
	env.SUMERU_CONFIG = `./${basename(args.configPath)}`;

	return env;
}

/** Expand a leading `~` / `~/` to the user's home directory. */
function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

/** Minimal result shape from a `spawnSync`-style probe runner. */
export type SpawnSyncResult = {
	status: number | null;
	error: Error | null;
};

/** Injectable `docker info` probe runner. Defaults to `node:child_process`. */
export type SpawnSyncFn = (command: string, args: string[]) => SpawnSyncResult;

function defaultSpawnSync(command: string, args: string[]): SpawnSyncResult {
	const result = spawnSync(command, args, { stdio: "ignore" });
	return { status: result.status, error: result.error ?? null };
}

/**
 * Probe Docker availability via `docker info`. Returns `false` when the binary
 * is missing (spawn error, e.g. `ENOENT`) OR the process exits non-zero
 * (daemon down / unusable); `true` only on a clean `status === 0`.
 */
export function isDockerAvailable(
	run: SpawnSyncFn = defaultSpawnSync,
): boolean {
	const result = run(dockerBin(), ["info"]);
	if (result.error !== null) return false;
	return result.status === 0;
}

/** A spawned compose child, reduced to the two events the launcher needs. */
export type LaunchChild = {
	onExit: (cb: (code: number | null) => void) => void;
	onError: (cb: (err: Error) => void) => void;
};

/** Options passed to the compose spawn seam. */
export type SpawnComposeOptions = {
	cwd: string;
	stdio: "inherit";
	env: Record<string, string>;
};

/** Injectable compose spawner. Defaults to `node:child_process` `spawn`. */
export type SpawnComposeFn = (
	bin: string,
	args: string[],
	options: SpawnComposeOptions,
) => LaunchChild;

/** Injectable dependencies for `launchDockerCompose` (test seams). */
export type DockerLaunchDeps = {
	spawnCompose: SpawnComposeFn;
};

function defaultSpawnCompose(
	bin: string,
	args: string[],
	options: SpawnComposeOptions,
): LaunchChild {
	const child = spawn(bin, args, {
		cwd: options.cwd,
		stdio: options.stdio,
		env: options.env,
	});
	return {
		onExit: (cb) => {
			child.on("exit", (code) => cb(code));
		},
		onError: (cb) => {
			child.on("error", (err) => cb(err));
		},
	};
}

const DEFAULT_DEPS: DockerLaunchDeps = {
	spawnCompose: defaultSpawnCompose,
};

/**
 * Full docker-mode launch: materialize any ABSENT templates into the unit dir
 * (reuse-don't-clobber), then spawn `docker compose -p <name> up -d --build`
 * with `cwd` = the unit dir and inherited stdio. Resolves with the child's
 * exit code (a signal death resolves with `1`).
 *
 * The caller is responsible for the availability probe (`isDockerAvailable`)
 * before invoking this — so on a Docker-less host no compose child and no
 * template write ever happen (see start-docker-unavailable.md).
 */
export function launchDockerCompose(
	args: LaunchArgs,
	deps: DockerLaunchDeps = DEFAULT_DEPS,
): Promise<number> {
	const unitDir = dirname(args.configPath);
	materializeMissing(unitDir);
	const env = buildComposeEnv(args);
	const bin = dockerBin();
	const argv = ["compose", "-p", args.name, "up", "-d", "--build"];

	return new Promise<number>((resolve, reject) => {
		const child = deps.spawnCompose(bin, argv, {
			cwd: unitDir,
			stdio: "inherit",
			env,
		});
		child.onExit((code) => {
			resolve(code === null ? 1 : code);
		});
		child.onError((err) => {
			reject(err);
		});
	});
}

/**
 * Materialize only the templates ABSENT from `unitDir`, leaving any existing
 * file byte-for-byte unchanged (reuse-don't-clobber). Because Phase-1
 * `materializeDockerAssets` overwrites unconditionally, we stage it in a
 * throwaway temp dir and copy across only the missing files. When all three
 * already exist, nothing is written at all.
 */
function materializeMissing(unitDir: string): void {
	const missing = TEMPLATE_NAMES.filter(
		(name) => !existsSync(join(unitDir, name)),
	);
	if (missing.length === 0) return;

	const staging = mkdtempSync(join(tmpdir(), "sumeru-tpl-"));
	try {
		materializeDockerAssets(staging);
		for (const name of missing) {
			copyFileSync(join(staging, name), join(unitDir, name));
		}
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
